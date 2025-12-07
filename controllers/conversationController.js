const { supabaseAdmin } = require("../supabase/client");
const adminPaymentFlowService = require("../utils/adminPaymentFlowService");
const notificationService = require("../services/notificationService");
const fcmService = require("../services/fcmService");
const conversationListUtils = require("../utils/conversationListUpdates");

// Small helper to emit via Socket.IO
function getIO(req) {
  try {
    return req.app && req.app.get("io");
  } catch (_) {
    return null;
  }
}

// Fetch conversation and participants
async function fetchConversation(conversationId) {
  const { data: conv, error } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single();
  if (error || !conv) throw new Error("Conversation not found");
  return conv;
}

// Determine agreed amount (final_agreed_amount from related request if available, else flow_data.agreed_amount)
async function resolveAgreedAmount(conversation) {
  // Try request by campaign
  if (conversation.campaign_id) {
    const { data: reqByPair } = await supabaseAdmin
      .from("requests")
      .select("id, final_agreed_amount")
      .eq("influencer_id", conversation.influencer_id)
      .eq("campaign_id", conversation.campaign_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (reqByPair && reqByPair.final_agreed_amount) {
      return parseFloat(reqByPair.final_agreed_amount);
    }
  }
  // Fallback to conversation.flow_data.agreed_amount
  if (conversation.flow_data && conversation.flow_data.agreed_amount) {
    const amt = parseFloat(conversation.flow_data.agreed_amount);
    if (!isNaN(amt) && amt > 0) return amt;
  }
  return null;
}

async function getPaymentBreakdownForConversation(conversation) {
  const agreedAmount = await resolveAgreedAmount(conversation);
  if (!agreedAmount) return null;
  const breakdown = await adminPaymentFlowService.calculatePaymentBreakdown(agreedAmount);
  // Normalize with rupees for convenience
  return {
    commission_percentage: breakdown.commission_percentage,
    total_amount: breakdown.total_amount_paise / 100,
    commission_amount: breakdown.commission_amount_paise / 100,
    net_amount: breakdown.net_amount_paise / 100,
    advance_amount: breakdown.advance_amount_paise / 100,
    final_amount: breakdown.final_amount_paise / 100,
  };
}

// Insert automated message with optional attachments
async function createAutomatedMessage({ conversationId, senderId, receiverId, text, attachments }) {
  const messagePayload = {
    conversation_id: conversationId,
    sender_id: senderId || null,
    receiver_id: receiverId || null,
    message: text,
    message_type: "automated", // Fixed: Changed from "system" to "automated"
  };
  if (attachments && attachments.length > 0) {
    messagePayload.attachment_metadata = { attachments };
  }
  const { data: msg, error } = await supabaseAdmin
    .from("messages")
    .insert(messagePayload)
    .select()
    .single();
  if (error) throw new Error(`Failed to create message: ${error.message}`);
  return msg;
}

// Basic state transition guard logic
// Work submission actions (submit_work, request_revision, approve_work) are handled by automatedFlowService
function canTransition(from, action) {
  const table = {
    close: ["work_approved"],
  };
  const allowed = table[action] || [];
  return allowed.includes(from);
}

async function updateConversationState(conversationId, fromState, toState, awaitingRole) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .update({ flow_state: toState, awaiting_role: awaitingRole || null, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .select()
    .single();
  if (error) throw new Error(`Failed to update state: ${error.message}`);
  return data;
}

class ConversationController {
  async getConversation(req, res) {
    try {
      const { id } = req.params;
      const conv = await fetchConversation(id);
      const payment_breakdown = await getPaymentBreakdownForConversation(conv);
      return res.json({ success: true, conversation: conv, payment_breakdown });
    } catch (error) {
      return res.status(404).json({ success: false, error: error.message });
    }
  }

  /**
   * Test/Preview MOU generation - shows all data that will be used
   * GET /api/conversations/:id/mou/preview
   * Useful for testing and debugging
   */
  async previewMOU(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      // Fetch all conversation details that will be used for MOU
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(`
          id,
          brand_owner_id,
          influencer_id,
          campaign_id,
          flow_data,
          created_at,
          brand_owner:users!conversations_brand_owner_id_fkey(
            id, name, email, phone, brand_name
          ),
          influencer:users!conversations_influencer_id_fkey(
            id, name, email, phone
          ),
          campaigns(id, title, description, budget)
        `)
        .eq("id", id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
          error: convError?.message
        });
      }

      // Check if user has access
      if (userId && conversation.brand_owner_id !== userId && conversation.influencer_id !== userId && req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied"
        });
      }

      // Get payment breakdown
      const mouService = require('../services/mouService');
      const paymentBreakdown = await mouService.getPaymentBreakdown(id);

      // Prepare preview data
      const collaborationType = "Campaign";
      const collaborationTitle = conversation.campaigns?.title;
      const collaborationDescription = conversation.campaigns?.description;
      const totalAmount = conversation.campaigns?.budget;

      return res.json({
        success: true,
        preview: {
          conversation_id: id,
          brand_owner: {
            id: conversation.brand_owner?.id,
            name: conversation.brand_owner?.name,
            email: conversation.brand_owner?.email,
            phone: conversation.brand_owner?.phone,
            brand_name: conversation.brand_owner?.brand_name
          },
          influencer: {
            id: conversation.influencer?.id,
            name: conversation.influencer?.name,
            email: conversation.influencer?.email,
            phone: conversation.influencer?.phone
          },
          collaboration: {
            type: collaborationType,
            title: collaborationTitle,
            description: collaborationDescription,
            total_amount: totalAmount
          },
          payment_breakdown: paymentBreakdown,
          conversation_created_at: conversation.created_at,
          flow_data: conversation.flow_data
        },
        can_generate: !!(conversation.brand_owner && conversation.influencer && paymentBreakdown.totalAmount > 0),
        missing_data: {
          brand_owner: !conversation.brand_owner,
          influencer: !conversation.influencer,
          collaboration_title: !collaborationTitle,
          payment_amount: paymentBreakdown.totalAmount === 0
        }
      });
    } catch (error) {
      console.error("Error previewing MOU:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }

  /**
   * Test MOU generation - manually trigger and return full details
   * POST /api/conversations/:id/mou/test
   * Useful for testing MOU generation
   */
  async testMOU(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      // Check access
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("id, brand_owner_id, influencer_id")
        .eq("id", id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      // Only admin can test MOU generation
      if (req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only admin can test MOU generation"
        });
      }

      // Generate MOU
      const mouService = require('../services/mouService');
      const mouResult = await mouService.generateMOU(id);

      if (mouResult.success) {
        return res.json({
          success: true,
          message: "MOU generated successfully",
          mou_content: mouResult.mouContent,
          mou_html: mouResult.mouHtml,
          generated_at: new Date().toISOString()
        });
      } else {
        return res.status(500).json({
          success: false,
          message: "Failed to generate MOU",
          error: mouResult.error
        });
      }
    } catch (error) {
      console.error("Error testing MOU:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }

  /**
   * Get MOU document for a conversation
   * GET /api/conversations/:id/mou
   */
  async getMOU(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      // Fetch conversation to check access
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("id, brand_owner_id, influencer_id, flow_data")
        .eq("id", id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      // Check if user has access to this conversation
      if (userId && conversation.brand_owner_id !== userId && conversation.influencer_id !== userId && req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied"
        });
      }

      // Check if MOU exists in mou_documents table
      const { data: existingMOU, error: mouFetchError } = await supabaseAdmin
        .from("mou_documents")
        .select("mou_content, mou_html, generated_at")
        .eq("conversation_id", id)
        .maybeSingle();

      if (mouFetchError && !mouFetchError.message?.includes("does not exist")) {
        console.error("Error fetching MOU:", mouFetchError);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch MOU",
          error: mouFetchError.message
        });
      }

      if (!existingMOU || !existingMOU.mou_content) {
        // Check if payment has been completed (MOU should be generated after payment)
        const { data: convCheck } = await supabaseAdmin
          .from("conversations")
          .select("flow_state, flow_data")
          .eq("id", id)
          .single();

        const paymentCompleted = convCheck?.flow_data?.payment_completed ||
          convCheck?.flow_state === "payment_completed" ||
          convCheck?.flow_state === "work_in_progress" ||
          convCheck?.flow_state === "work_submitted" ||
          convCheck?.flow_state === "work_approved";

        if (!paymentCompleted) {
          return res.status(400).json({
            success: false,
            message: "MOU can only be generated after payment is completed"
          });
        }

        // Generate MOU if payment is completed but MOU doesn't exist
        try {
          const mouService = require('../services/mouService');
          const mouResult = await mouService.generateMOU(id);

          if (mouResult.success) {
            return res.json({
              success: true,
              mou_content: mouResult.mouContent,
              mou_html: mouResult.mouHtml,
              generated_at: new Date().toISOString()
            });
          } else {
            return res.status(500).json({
              success: false,
              message: "Failed to generate MOU",
              error: mouResult.error
            });
          }
        } catch (mouError) {
          console.error("Error generating MOU:", mouError);
          return res.status(500).json({
            success: false,
            message: "Failed to generate MOU",
            error: mouError.message
          });
        }
      }

      // Return existing MOU from mou_documents table
      return res.json({
        success: true,
        mou_content: existingMOU.mou_content,
        mou_html: existingMOU.mou_html,
        generated_at: existingMOU.generated_at
      });
    } catch (error) {
      console.error("Error getting MOU:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }

  // POST /api/conversations/:id/actions
  async performAction(req, res) {
    try {
      const { id } = req.params;
      const { action, payload = {} } = req.body || {};
      const userId = req.user.id;

      if (!action) {
        return res.status(400).json({ success: false, error: "action is required" });
      }

      const conv = await fetchConversation(id);

      // Role guards for actions handled by this controller
      // Work submission actions (submit_work, request_revision, approve_work) are handled by automatedFlowService
      if ((action === "accept_price" || action === "reject_price" || action === "negotiate_price") && req.user.role !== "brand_owner") {
        return res.status(403).json({ success: false, error: "Only brand owner can perform this action" });
      }

      // State guards
      if (!canTransition(conv.flow_state, action)) {
        return res.status(409).json({ success: false, error: `Invalid state transition from ${conv.flow_state} via ${action}` });
      }

      const io = getIO(req);
      let newState = conv.flow_state;
      let awaitingRole = conv.awaiting_role;
      let createdMessage = null;

      // Work submission actions are now handled by automatedFlowService via button-click endpoint
      // This ensures consistency with the existing automated flow system
      if (action === "submit_work" || action === "request_revision" || action === "approve_work") {
        return res.status(400).json({
          success: false,
          error: `Action '${action}' should be called via /api/messages/conversations/:conversation_id/button-click endpoint for automated flow consistency`
        });
      }

      if (action === "close") {
        createdMessage = await createAutomatedMessage({
          conversationId: id,
          senderId: userId,
          receiverId: null,
          text: payload.note || "Conversation closed",
        });
        newState = "closed";
        awaitingRole = null;
      }

      const updatedConv = await updateConversationState(id, conv.flow_state, newState, awaitingRole);

      // Emits
      if (io) {
        io.to(`conversation_${id}`).emit("conversation_state_changed", {
          conversation_id: id,
          previous_state: conv.flow_state,
          new_state: newState,
          reason: action,
          timestamp: new Date().toISOString(),
        });
        if (createdMessage) {
          io.to(`conversation_${id}`).emit("new_message", {
            conversation_id: id,
            message: createdMessage,
            conversation_context: {
              id: id,
              flow_state: newState,
              awaiting_role: awaitingRole,
              chat_status: 'automated'
            }
          });

          // Send notifications for automated message
          const receiverId = createdMessage.receiver_id || (conv.brand_owner_id === userId ? conv.influencer_id : conv.brand_owner_id);
          if (receiverId) {
            // Get sender name
            const { data: sender } = await supabaseAdmin.from('users').select('name').eq('id', userId).single();
            const senderName = sender?.name || 'System';

            // Store notification
            await notificationService.storeNotification({
              user_id: receiverId,
              type: 'message',
              title: `Conversation closed by ${senderName}`,
              message: createdMessage.message,
              data: {
                conversation_id: id,
                message: createdMessage,
                conversation_context: {
                  id: id,
                  chat_status: newState,
                  flow_state: newState,
                  awaiting_role: awaitingRole
                },
                sender_id: userId,
                receiver_id: receiverId,
                sender_name: senderName
              },
              action_url: `/conversations/${id}`
            }, io);

            // Send FCM notification
            await fcmService.sendMessageNotification(
              id,
              createdMessage,
              userId,
              receiverId,
              io
            );

            // Update conversation lists
            await conversationListUtils.emitConversationsUpsertToBothUsers(
              io,
              id,
              updatedConv,
              createdMessage
            );
          }
        }
      }

      // Return standardized response format (matching BidController and CampaignController)
      return res.json({
        success: true,
        conversation: updatedConv,
        message: createdMessage,
        audit_message: null, // ConversationController doesn't create audit messages
        flow_state: updatedConv.flow_state,
        awaiting_role: updatedConv.awaiting_role
      });
    } catch (error) {
      console.error("performAction error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // Admin payment endpoints (receive, release advance, release final, refund final)
  async receivePayment(req, res) {
    try {
      const { id } = req.params;
      const { amount, currency = "INR", reference, attachments = [], notes, commission_percent } = req.body || {};
      if (req.user.role !== "admin") return res.status(403).json({ success: false, error: "Admin only" });
      if (!amount || amount <= 0) return res.status(400).json({ success: false, error: "Valid amount required" });

      const conv = await fetchConversation(id);

      // Track brand owner payment to admin (for audit). We do not alter state here.
      const payload = {
        conversation_id: id,
        direction: "in",
        type: "credit",
        status: "completed",
        amount: amount,
        amount_paise: Math.round(Number(amount) * 100),
        notes: notes || `Payment received for conversation ${id}`,
        payment_stage: "received",
        admin_payment_tracking_id: reference || null,
      };

      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("transactions")
        .insert(payload)
        .select()
        .single();
      if (txnErr) return res.status(500).json({ success: false, error: txnErr.message });

      // Automated message with optional screenshot
      const msg = await createAutomatedMessage({
        conversationId: id,
        senderId: req.user.id,
        receiverId: null,
        text: `Admin recorded payment from brand owner: ₹${amount}${commission_percent ? ` (commission ${commission_percent}%)` : ""}`,
        attachments,
      });

      const io = getIO(req);
      if (io) {
        io.to(`conversation_${id}`).emit("new_message", { conversation_id: id, message: msg });
      }

      const payment_breakdown = await getPaymentBreakdownForConversation(conv);
      return res.json({ success: true, transaction: txn, message: msg, payment_breakdown });
    } catch (error) {
      console.error("receivePayment error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async releaseAdvance(req, res) {
    try {
      const { id } = req.params;
      const { amount, currency = "INR", payout_reference, attachments = [], notes, commission_percent } = req.body || {};
      if (req.user.role !== "admin") return res.status(403).json({ success: false, error: "Admin only" });
      if (!amount || amount <= 0) return res.status(400).json({ success: false, error: "Valid amount required" });

      const conv = await fetchConversation(id);

      // Record payout to influencer
      const payout = {
        conversation_id: id,
        direction: "out",
        type: "debit",
        status: "completed",
        amount: amount,
        amount_paise: Math.round(Number(amount) * 100),
        notes: notes || `Advance released to influencer for conversation ${id}`,
        payment_stage: "advance",
        admin_payment_tracking_id: payout_reference || null,
        receiver_id: conv.influencer_id,
        sender_id: req.user.id,
      };
      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("transactions")
        .insert(payout)
        .select()
        .single();
      if (txnErr) return res.status(500).json({ success: false, error: txnErr.message });

      // Move state to work_in_progress
      const updatedConv = await updateConversationState(id, conv.flow_state, "work_in_progress", "influencer");

      const msg = await createAutomatedMessage({
        conversationId: id,
        senderId: req.user.id,
        receiverId: conv.influencer_id,
        text: `Admin released advance ₹${amount}${commission_percent ? ` (commission ${commission_percent}%)` : ""}`,
        attachments,
      });

      const io = getIO(req);
      if (io) {
        io.to(`conversation_${id}`).emit("conversation_state_changed", {
          conversation_id: id,
          previous_state: conv.flow_state,
          new_state: "work_in_progress",
          reason: "release_advance",
          timestamp: new Date().toISOString(),
        });
        io.to(`conversation_${id}`).emit("new_message", { conversation_id: id, message: msg });
      }

      const payment_breakdown = await getPaymentBreakdownForConversation(updatedConv);
      return res.json({ success: true, transaction: txn, conversation: updatedConv, message: msg, payment_breakdown });
    } catch (error) {
      console.error("releaseAdvance error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async releaseFinal(req, res) {
    try {
      const { id } = req.params;
      const { amount, currency = "INR", payout_reference, attachments = [], notes, commission_percent } = req.body || {};
      if (req.user.role !== "admin") return res.status(403).json({ success: false, error: "Admin only" });
      if (!amount || amount <= 0) return res.status(400).json({ success: false, error: "Valid amount required" });

      const conv = await fetchConversation(id);
      if (conv.flow_state !== "work_approved") {
        return res.status(409).json({ success: false, error: "Final can be released only after work_approved" });
      }

      // Record payout to influencer
      const payout = {
        conversation_id: id,
        direction: "out",
        type: "debit",
        status: "completed",
        amount: amount,
        amount_paise: Math.round(Number(amount) * 100),
        notes: notes || `Final payment released to influencer for conversation ${id}`,
        payment_stage: "final",
        admin_payment_tracking_id: payout_reference || null,
        receiver_id: conv.influencer_id,
        sender_id: req.user.id,
      };
      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("transactions")
        .insert(payout)
        .select()
        .single();
      if (txnErr) return res.status(500).json({ success: false, error: txnErr.message });

      // Move state to closed
      const updatedConv = await updateConversationState(id, conv.flow_state, "closed", null);

      const msg = await createAutomatedMessage({
        conversationId: id,
        senderId: req.user.id,
        receiverId: conv.influencer_id,
        text: `Admin released final ₹${amount}${commission_percent ? ` (commission ${commission_percent}%)` : ""}. Conversation closed.`,
        attachments,
      });

      const io = getIO(req);
      if (io) {
        io.to(`conversation_${id}`).emit("conversation_state_changed", {
          conversation_id: id,
          previous_state: conv.flow_state,
          new_state: "closed",
          reason: "release_final",
          timestamp: new Date().toISOString(),
        });
        io.to(`conversation_${id}`).emit("new_message", { conversation_id: id, message: msg });
      }

      const payment_breakdown = await getPaymentBreakdownForConversation(updatedConv);
      return res.json({ success: true, transaction: txn, conversation: updatedConv, message: msg, payment_breakdown });
    } catch (error) {
      console.error("releaseFinal error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async refundFinal(req, res) {
    try {
      const { id } = req.params;
      const { amount, currency = "INR", refund_reference, attachments = [], notes } = req.body || {};
      if (req.user.role !== "admin") return res.status(403).json({ success: false, error: "Admin only" });
      if (!amount || amount <= 0) return res.status(400).json({ success: false, error: "Valid amount required" });

      const conv = await fetchConversation(id);

      // Record refund back to brand owner
      const refund = {
        conversation_id: id,
        direction: "out",
        type: "debit",
        status: "completed",
        amount: amount,
        amount_paise: Math.round(Number(amount) * 100),
        notes: notes || `Final refund paid back to brand owner for conversation ${id}`,
        payment_stage: "refund_final",
        admin_payment_tracking_id: refund_reference || null,
        receiver_id: conv.brand_owner_id,
        sender_id: req.user.id,
      };
      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("transactions")
        .insert(refund)
        .select()
        .single();
      if (txnErr) return res.status(500).json({ success: false, error: txnErr.message });

      const msg = await createAutomatedMessage({
        conversationId: id,
        senderId: req.user.id,
        receiverId: conv.brand_owner_id,
        text: `Admin refunded ₹${amount} to brand owner`,
        attachments,
      });

      const io = getIO(req);
      if (io) {
        io.to(`conversation_${id}`).emit("new_message", { conversation_id: id, message: msg });
      }

      const payment_breakdown = await getPaymentBreakdownForConversation(conv);
      return res.json({ success: true, transaction: txn, message: msg, payment_breakdown });
    } catch (error) {
      console.error("refundFinal error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = {
  ConversationController: new ConversationController(),
};


