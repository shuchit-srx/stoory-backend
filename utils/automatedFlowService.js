const { supabaseAdmin } = require("../supabase/client");
const socketEmitter = require("../services/socketEmitter");

// System user ID for automated messages
const SYSTEM_USER_ID =
  process.env.SYSTEM_USER_ID || "00000000-0000-0000-0000-000000000000";

class AutomatedFlowService {
  constructor() {
    this.io = null;
  }

  /**
   * Set the socket.io instance
   */
  setIO(io) {
    this.io = io;
  }

  /**
   * Helper to emit automated message via socket
   */
  emitAutomatedMessage(conversationId, message, reason = 'automated') {
    try {
      console.log(`🤖 [AUTO] chat:automated -> room:${conversationId} msg:${message?.id || 'n/a'} reason:${reason}`);
      socketEmitter.emitToConversation(conversationId, 'chat:automated', {
        message,
        reason
      });
    } catch (error) {
      console.error('Failed to emit automated message:', error);
    }
  }

  /**
   * Calculate payment breakdown with commission (helper function)
   */
  async calculatePaymentBreakdown(agreedAmount) {
    try {
      // Get current commission settings
      const { data: commissionSettings, error: commError } = await supabaseAdmin
        .from("commission_settings")
        .select("*")
        .eq("is_active", true)
        .order("effective_from", { ascending: false })
        .limit(1)
        .single();

      if (commError || !commissionSettings) {
        console.warn("⚠️ No commission settings found, using default 10%");
        var commissionPercentage = 10.00;
      } else {
        var commissionPercentage = commissionSettings.commission_percentage;
      }

      const totalAmountPaise = Math.round(agreedAmount * 100);
      const commissionAmountPaise = Math.round((totalAmountPaise * commissionPercentage) / 100);
      const netAmountPaise = totalAmountPaise - commissionAmountPaise;
      const advanceAmountPaise = Math.round(netAmountPaise * 0.30); // 30%
      const finalAmountPaise = netAmountPaise - advanceAmountPaise; // 70%

      return {
        total_amount_paise: totalAmountPaise,
        commission_amount_paise: commissionAmountPaise,
        net_amount_paise: netAmountPaise,
        advance_amount_paise: advanceAmountPaise,
        final_amount_paise: finalAmountPaise,
        commission_percentage: commissionPercentage,
        // Add formatted display strings
        display: {
          total: `₹${(totalAmountPaise / 100).toFixed(2)}`,
          commission: `₹${(commissionAmountPaise / 100).toFixed(2)} (${commissionPercentage}%)`,
          net_to_influencer: `₹${(netAmountPaise / 100).toFixed(2)}`,
          advance: `₹${(advanceAmountPaise / 100).toFixed(2)} (30%)`,
          final: `₹${(finalAmountPaise / 100).toFixed(2)} (70%)`
        }
      };
    } catch (error) {
      console.error("❌ Error calculating payment breakdown:", error);
      throw error;
    }
  }

  /**
   * Emit global conversation list updates
   */
  emitGlobalConversationUpdate(conversation, conversationId, updateData) {
    if (!this.io) return;

    try {
      // Emit to both users' global update rooms
      console.log(`🗂️ [LIST] conversation_list_updated -> users:${conversation.brand_owner_id},${conversation.influencer_id} action:${updateData?.action || 'state_changed'} conv:${conversationId}`);
      this.io.to(`user_${conversation.brand_owner_id}`).emit('conversation_list_updated', {
        conversation_id: conversationId,
        ...updateData,
        timestamp: new Date().toISOString()
      });

      this.io.to(`user_${conversation.influencer_id}`).emit('conversation_list_updated', {
        conversation_id: conversationId,
        ...updateData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ [DEBUG] Global update emit error:", error);
    }
  }

  /**
   * Initialize automated conversation for a bid application
   */
  async initializeBidConversation(bidId, influencerId, proposedAmount) {
    try {
      // Get bid details
      const { data: bid, error: bidError } = await supabaseAdmin
        .from("bids")
        .select("*, users!bids_created_by_fkey(name, role)")
        .eq("id", bidId)
        .single();

      if (bidError || !bid) {
        throw new Error("Bid not found");
      }

      // Get influencer details
      const { data: influencer, error: influencerError } = await supabaseAdmin
        .from("users")
        .select("name, role")
        .eq("id", influencerId)
        .single();

      if (influencerError || !influencer) {
        throw new Error("Influencer not found");
      }

      // Check if conversation already exists for this specific bid context
      const { data: existingConversations, error: checkError } =
        await supabaseAdmin
          .from("conversations")
          .select("*, messages(*)")
          .eq("bid_id", bidId)
          .eq("brand_owner_id", bid.created_by)
          .eq("influencer_id", influencerId);

      // If conversations exist for this bid context, use the most recent one
      if (existingConversations && existingConversations.length > 0) {
        const sortedConversations = existingConversations.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
        const existingConversation = sortedConversations[0];

        console.log(
          "✅ Conversation already exists for this bid:",
          existingConversation.id
        );

        // Get the latest message to show current state
        const { data: latestMessage, error: msgError } = await supabaseAdmin
          .from("messages")
          .select("*")
          .eq("conversation_id", existingConversation.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (msgError) {
          console.log("⚠️  Could not fetch latest message:", msgError.message);
        }

        return {
          success: true,
          conversation: existingConversation,
          message: latestMessage || null,
          flow_state: existingConversation.flow_state || "initial",
          awaiting_role: existingConversation.awaiting_role || "brand_owner",
          is_existing: true,
          status_message:
            "Conversation already exists for this bid - redirecting to chat",
        };
      }

      if (checkError) {
        console.error("❌ Error checking existing conversations:", checkError);
        throw new Error(
          `Failed to check existing conversations: ${checkError.message}`
        );
      }

      // Create conversation with automated flow
      const conversationData = {
        bid_id: bidId,
        brand_owner_id: bid.created_by,
        influencer_id: influencerId,
        flow_state: "influencer_responding", // Start directly in influencer_responding state
        awaiting_role: "influencer", // Influencer needs to respond
        chat_status: "automated"
      };

      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .insert(conversationData)
          .select()
          .single();

      if (conversationError) {
        console.error("❌ Failed to create conversation:", conversationError);
        throw new Error(
          `Failed to create conversation: ${conversationError.message}`
        );
      }

      // Ensure a request exists and store the proposed amount; link it to the conversation
      let requestForPair = null;
      const { data: existingRequest } = await supabaseAdmin
        .from("requests")
        .select("id, proposed_amount")
        .eq("bid_id", bidId)
        .eq("influencer_id", influencerId)
        .single();

      if (existingRequest) {
        requestForPair = existingRequest;
        // Update proposed_amount if provided
        if (proposedAmount) {
          await supabaseAdmin
            .from("requests")
            .update({ proposed_amount: parseFloat(proposedAmount) })
            .eq("id", existingRequest.id);
        }
      } else {
        const { data: newRequest } = await supabaseAdmin
          .from("requests")
          .insert({
            bid_id: bidId,
            influencer_id: influencerId,
            status: "connected",
            proposed_amount: proposedAmount ? parseFloat(proposedAmount) : null
          })
          .select()
          .single();
        requestForPair = newRequest;
      }

      if (requestForPair && requestForPair.id) {
        await supabaseAdmin
          .from("conversations")
          .update({ request_id: requestForPair.id })
          .eq("id", conversation.id);
      }

      // Create initial message from brand owner to influencer
      const initialMessage = {
        conversation_id: conversation.id,
        sender_id: bid.created_by, // Brand owner sends the message
        receiver_id: influencerId,
        message: `🤝 **Interest in Collaboration**\n\nHi **${influencer.name}**! I'm interested in connecting with you for my bid **"${bid.title}"**.\n\nYour proposed amount of **₹${proposedAmount}** looks good. Let's discuss the project details and move forward with this collaboration.`,
        message_type: "automated",
        action_required: true,
        action_data: {
          title: "🎯 **Connection Response**",
          subtitle:
            "Choose how you'd like to respond to this connection request:",
          buttons: [
            {
              id: "accept_connection",
              text: "Accept Connection",
              style: "success",
              action: "accept_connection",
            },
            {
              id: "reject_connection",
              text: "Reject Connection",
              style: "danger",
              action: "reject_connection",
            },
          ],
          flow_state: "influencer_responding",
          message_type: "influencer_connection_response",
          visible_to: "influencer",
        },
      };

      // Insert only the initial actionable message
      const messagesToInsert = [initialMessage];
      const { data: messages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messagesToInsert)
        .select();

      if (messageError) {
        console.error("❌ Failed to create initial message:", messageError);
        throw new Error(
          `Failed to create initial message: ${messageError.message}`
        );
      }

      // Emit socket event for new message
      if (messages && messages[0]) {
        this.emitAutomatedMessage(conversation.id, messages[0]);
      }

      // Send FCM notification to influencer
      const fcmService = require('../services/fcmService');
      fcmService.sendFlowStateNotification(
        conversation.id, 
        influencerId, 
        "influencer_responding",
        "You have a new connection request"
      ).then(result => {
        if (result.success) {
          console.log(`✅ FCM notification sent to influencer: ${result.sent} successful, ${result.failed} failed`);
        } else {
          console.error(`❌ FCM notification failed:`, result.error);
        }
      }).catch(error => {
        console.error(`❌ FCM notification error:`, error);
      });

      console.log(
        "✅ Bid conversation initialized successfully:",
        conversation.id
      );

      return {
        success: true,
        conversation: conversation,
        message: messages[0], // Initial message
        flow_state: "influencer_responding", // Already in influencer_responding state
        awaiting_role: "influencer", // Influencer needs to respond
        is_existing: false,
        status_message: "New bid conversation created successfully",
      };
    } catch (error) {
      console.error("❌ Failed to initialize bid conversation:", error);
      throw error;
    }
  }

  /**
   * Initialize automated conversation for a campaign connection
   */
  async initializeCampaignConversation(campaignId, influencerId) {
    try {
      // Get campaign details
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("campaigns")
        .select("*, users!campaigns_created_by_fkey(name, role)")
        .eq("id", campaignId)
        .single();

      if (campaignError || !campaign) {
        throw new Error("Campaign not found");
      }

      // Get influencer details
      const { data: influencer, error: influencerError } = await supabaseAdmin
        .from("users")
        .select("name, role")
        .eq("id", influencerId)
        .single();

      if (influencerError || !influencer) {
        throw new Error("Influencer not found");
      }

      // Check if conversation already exists for this specific campaign context
      const { data: existingConversations, error: checkError } =
        await supabaseAdmin
          .from("conversations")
          .select("*, messages(*)")
          .eq("campaign_id", campaignId)
          .eq("brand_owner_id", campaign.created_by)
          .eq("influencer_id", influencerId);

      // If conversations exist for this campaign context, use the most recent one
      if (existingConversations && existingConversations.length > 0) {
        const existingConversation = existingConversations[0];
        console.log(
          "✅ Using existing campaign conversation:",
          existingConversation.id
        );

        return {
          success: true,
          conversation: existingConversation,
          flow_state: existingConversation.flow_state,
          awaiting_role: existingConversation.awaiting_role,
          is_existing: true,
          status_message: "Existing campaign conversation found",
        };
      }

      // Create new conversation for campaign
      const conversationData = {
        brand_owner_id: campaign.created_by,
        influencer_id: influencerId,
        campaign_id: campaignId,
        flow_state: "influencer_responding",
        awaiting_role: "influencer",
        chat_status: "automated"
      };

      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .insert(conversationData)
        .select()
        .single();

      if (convError) {
        console.error("❌ Failed to create campaign conversation:", convError);
        throw new Error(
          `Failed to create campaign conversation: ${convError.message}`
        );
      }

      // Create initial message for campaign
      const initialMessage = {
        conversation_id: conversation.id,
        sender_id: campaign.created_by, // Brand owner sends the message
        receiver_id: influencerId,
        message: `🎯 **Campaign Connection Established**

Hello ${influencer.name}! 

You've been connected to the campaign **"${campaign.title}"** by ${campaign.users.name}.

**Campaign Details:**
- **Budget:** ₹${campaign.budget}
- **Description:** ${campaign.description}
- **Requirements:** ${campaign.requirements || 'Not specified'}

Please respond to confirm your interest and availability for this campaign.`,
        message_type: "automated",
        action_required: true,
        action_data: {
          title: "🎯 **Campaign Response**",
          subtitle: "Choose how you'd like to respond to this campaign connection:",
          buttons: [
            {
              id: "accept_connection",
              text: "Accept Connection",
              style: "success",
              action: "accept_connection",
            },
            {
              id: "reject_connection",
              text: "Reject Connection", 
              style: "danger",
              action: "reject_connection",
            }
          ],
          flow_state: "influencer_responding",
          message_type: "influencer_campaign_response",
          visible_to: "influencer",
        },
        is_automated: true,
      };

      // Insert initial message
      const { data: messages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert([initialMessage])
        .select();

      if (messageError) {
        console.error("❌ Failed to create initial message:", messageError);
        throw new Error(
          `Failed to create initial message: ${messageError.message}`
        );
      }

      // Emit socket event for new message
      if (messages && messages[0]) {
        this.emitAutomatedMessage(conversation.id, messages[0]);
      }

      // Send FCM notification to influencer
      const fcmService = require('../services/fcmService');
      fcmService.sendFlowStateNotification(
        conversation.id, 
        influencerId, 
        "influencer_responding",
        "You have a new campaign connection"
      ).then(result => {
        if (result.success) {
          console.log(`✅ FCM notification sent to influencer: ${result.sent} successful, ${result.failed} failed`);
        } else {
          console.error(`❌ FCM notification failed:`, result.error);
        }
      }).catch(error => {
        console.error(`❌ FCM notification error:`, error);
      });

      console.log(
        "✅ Campaign conversation initialized successfully:",
        conversation.id
      );

      return {
        success: true,
        conversation: conversation,
        message: messages[0],
        flow_state: "influencer_responding",
        awaiting_role: "influencer",
        is_existing: false,
        status_message: "New campaign conversation created successfully",
      };
    } catch (error) {
      console.error("❌ Failed to initialize campaign conversation:", error);
      throw error;
    }
  }

  /**
   * Helper to get conversation by ID
   */
  async getConversation(conversationId) {
    try {
      const { data: conversation, error } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (error || !conversation) {
        throw new Error("Conversation not found");
      }

      return conversation;
    } catch (error) {
      console.error("❌ Failed to get conversation:", error);
      throw error;
    }
  }

  /**
   * Handle brand owner actions in the automated flow
   */
  async handleBrandOwnerAction(conversationId, action, data = {}) {
    try {
      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      let newFlowState, newAwaitingRole, newMessage;
      console.log("🔍 [AF] handleBrandOwnerAction input:", {
        conversationId,
        action,
        data
      });

      switch (action) {
        case "accept_negotiation":
          // Brand owner accepts negotiation; influencer can now send negotiated price
          newFlowState = "influencer_negotiation_input";
          newAwaitingRole = "influencer";

          // Append to negotiation history
          const acceptNegHistory = Array.isArray(conversation.negotiation_history) ? conversation.negotiation_history : [];
          acceptNegHistory.push({ event: "negotiation_accepted", by: "brand_owner", at: new Date().toISOString() });
          await supabaseAdmin
            .from("conversations")
            .update({ negotiation_history: acceptNegHistory })
            .eq("id", conversationId);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: "✅ Negotiation Accepted\n\nPlease propose your new price.",
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "💬 Propose New Price",
              subtitle: "Enter your negotiated price to continue.",
              input_field: { id: "negotiated_price", type: "number", placeholder: "Enter price in ₹", required: true, min: 0 },
              submit_button: { text: "Send Negotiated Price", style: "success" },
              flow_state: "influencer_negotiation_input",
              message_type: "influencer_negotiation_input",
              visible_to: "influencer"
            }
          };
          break;

        case "reject_negotiation":
          // Brand owner rejects negotiation; go back to price response or close based on preference
          newFlowState = "influencer_price_response";
          newAwaitingRole = "influencer";

          const rejectNegHistory = Array.isArray(conversation.negotiation_history) ? conversation.negotiation_history : [];
          rejectNegHistory.push({ event: "negotiation_rejected", by: "brand_owner", at: new Date().toISOString() });
              await supabaseAdmin
                .from("conversations")
            .update({ negotiation_history: rejectNegHistory })
                .eq("id", conversationId);
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: "❌ Negotiation Rejected\n\nYou can accept the original price or try a counter again.",
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "Respond to Price",
              subtitle: "Choose how to proceed.",
              buttons: [
                { id: "accept_price", text: "Accept Price", style: "success", action: "accept_price", data: { price: conversation.flow_data?.price_offer } },
                { id: "negotiate_price", text: "Negotiate", style: "warning", action: "negotiate_price" },
                { id: "reject_price", text: "Reject", style: "danger", action: "reject_price", data: { price: conversation.flow_data?.price_offer } }
              ],
              flow_state: "influencer_price_response",
              message_type: "influencer_price_response",
              visible_to: "influencer"
            }
          };
          break;
        case "send_project_details":
          // Brand owner sends project details - influencer needs to review and accept/reject
          newFlowState = "influencer_reviewing";
            newAwaitingRole = "influencer";
            
          const projectDetails = data.details || data.project_details || "";
          console.log("🧩 [AF] send_project_details computed:", { projectDetails });

          // Store project details in flow_data
          const updatedFlowData = {
            ...(conversation.flow_data || {}),
            project_details: projectDetails,
            project_details_submitted_at: new Date().toISOString()
          };
          console.log("🧩 [AF] send_project_details flow_data update:", updatedFlowData);

            newMessage = {
              conversation_id: conversationId,
              sender_id: conversation.brand_owner_id,
              receiver_id: conversation.influencer_id,
            message: `📋 **Project Details**\n\n${projectDetails}\n\nPlease review the project details and confirm if you're interested in proceeding.`,
              message_type: "automated",
              action_required: true,
              action_data: {
              title: "📋 **Review Project Details**",
              subtitle: "Please review the project details above and decide:",
                buttons: [
                  {
                  id: "accept_project_details",
                  text: "Accept Project",
                    style: "success",
                  action: "accept_project_details",
                },
                {
                  id: "reject_project_details",
                  text: "Reject Project",
                  style: "danger",
                  action: "reject_project_details",
                },
              ],
              flow_state: "influencer_reviewing",
              message_type: "influencer_project_review",
                visible_to: "influencer",
              },
            };
          console.log("📝 [AF] send_project_details newMessage:", newMessage);

          // Update flow_data with project details
          await supabaseAdmin
            .from("conversations")
            .update({ flow_data: updatedFlowData })
            .eq("id", conversationId);
          break;

        case "send_price_offer":
          // Brand owner sends price offer
          newFlowState = "influencer_price_response";
          newAwaitingRole = "influencer";

          // Try to get price from input, then from request, then from flow_data
          let priceOffer = data.price ? parseFloat(data.price) : null;
          
          // If no price provided, try to get from request's proposed_amount
          if (!priceOffer && conversation.request_id) {
            const { data: requestData } = await supabaseAdmin
              .from("requests")
              .select("proposed_amount")
              .eq("id", conversation.request_id)
              .single();
            
            if (requestData && requestData.proposed_amount) {
              priceOffer = parseFloat(requestData.proposed_amount);
              console.log("🧮 [AF] send_price_offer using proposed_amount from request:", priceOffer);
            }
          }
          
          // If still no price, try from flow_data
          if (!priceOffer && conversation.flow_data && conversation.flow_data.price_offer) {
            priceOffer = parseFloat(conversation.flow_data.price_offer);
            console.log("🧮 [AF] send_price_offer using price_offer from flow_data:", priceOffer);
          }
          
          // If still no price, throw error
          if (!priceOffer || isNaN(priceOffer)) {
            throw new Error("Price offer is required. Either provide price in data.price, or ensure proposed_amount exists in the request.");
          }
          
          console.log("🧮 [AF] send_price_offer final price:", { input: data.price, priceOffer });

          // Update flow_data with price offer
          const priceFlowData = {
            ...(conversation.flow_data || {}),
            price_offer: priceOffer,
            price_offer_submitted_at: new Date().toISOString()
          };
          console.log("🧮 [AF] send_price_offer flow_data update:", priceFlowData);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💰 **Price Offer: ₹${priceOffer}**\n\nBrand owner has proposed ₹${priceOffer} for this project. Please review and respond.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "💬 **Respond to Price Offer**",
              subtitle: `Price offered: ₹${priceOffer}`,
              buttons: [
                {
                  id: "accept_price",
                  text: "Accept Price",
                  style: "success",
                  action: "accept_price",
                  data: { price: priceOffer },
                },
                {
                  id: "negotiate_price",
                  text: "Negotiate",
                  style: "warning",
                  action: "negotiate_price"
                },
                {
                  id: "reject_price",
                  text: "Reject Price",
                  style: "danger",
                  action: "reject_price",
                  data: { price: priceOffer },
                }
              ],
              flow_state: "influencer_price_response",
              message_type: "influencer_price_response",
              visible_to: "influencer",
            },
          };
          console.log("📝 [AF] send_price_offer newMessage:", newMessage);

          // Update flow_data with price offer and update request if exists
            if (conversation.request_id) {
            await supabaseAdmin
                .from("requests")
              .update({
                proposed_amount: priceOffer,
              })
              .eq("id", conversation.request_id);
          }

                  await supabaseAdmin
                    .from("conversations")
            .update({ flow_data: priceFlowData })
                    .eq("id", conversationId);
                  break;

        case "proceed_to_payment":
          // Brand owner proceeds to payment - create Razorpay order
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          const paymentAmount = data.price || conversation.flow_data?.agreed_price || conversation.flow_data?.negotiated_price || 0;
          
          // Calculate payment breakdown
          const paymentBreakdown = await this.calculatePaymentBreakdown(paymentAmount);

          // Create Razorpay order for frontend to use
          let razorpayOrder = null;
          const Razorpay = require("razorpay");
          
          if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
            const razorpay = new Razorpay({
              key_id: process.env.RAZORPAY_KEY_ID,
              key_secret: process.env.RAZORPAY_KEY_SECRET,
            });

            try {
              // Razorpay receipt must be <= 40 chars
              const rawReceipt = `conv_${conversationId}_${Date.now()}`;
              const safeReceipt = rawReceipt.substring(0, 40);
              const orderOptions = {
                amount: paymentBreakdown.total_amount_paise,
                currency: "INR",
                receipt: safeReceipt,
                notes: {
                  conversation_id: conversationId,
                  brand_owner_id: conversation.brand_owner_id,
                  influencer_id: conversation.influencer_id,
                  source_type: conversation.campaign_id ? "campaign" : conversation.bid_id ? "bid" : "direct",
                  request_id: conversation.request_id || null,
                },
              };

              razorpayOrder = await razorpay.orders.create(orderOptions);
              
              // Store order ID in flow_data for later reference
              const orderFlowData = {
                ...(conversation.flow_data || {}),
                razorpay_order_id: razorpayOrder.id,
                payment_order_created_at: new Date().toISOString()
              };
              
              await supabaseAdmin
                .from("conversations")
                .update({ flow_data: orderFlowData })
                .eq("id", conversationId);
              
            } catch (orderError) {
              console.error("❌ Failed to create Razorpay order:", orderError);
              // Don't throw - allow flow to continue, frontend can retry
            }
          }

          // Create a visible message instructing to pay now, include order details in action_data
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💳 **Payment Order Created**\n\nPayment details:\n• Amount: ${paymentBreakdown.display.total}\n• Platform Fee: ${paymentBreakdown.display.commission}\n• Net to Influencer: ${paymentBreakdown.display.net_to_influencer}`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "💳 **Complete Payment**",
              subtitle: razorpayOrder ? "Click Pay Now to process payment with Razorpay" : "Payment service unavailable",
              payment_breakdown: {
                total_amount: paymentBreakdown.total_amount_paise,
                commission_amount: paymentBreakdown.commission_amount_paise,
                commission_percentage: paymentBreakdown.commission_percentage,
                net_amount: paymentBreakdown.net_amount_paise,
                advance_amount: paymentBreakdown.advance_amount_paise,
                final_amount: paymentBreakdown.final_amount_paise,
                display: paymentBreakdown.display
              },
              razorpay_order: razorpayOrder ? {
                id: razorpayOrder.id,
                amount: razorpayOrder.amount,
                currency: razorpayOrder.currency,
                receipt: razorpayOrder.receipt,
                key_id: process.env.RAZORPAY_KEY_ID
              } : null,
              // Frontend can auto-trigger SDK when it sees razorpay_order, or show an explicit Pay Now button
              buttons: razorpayOrder ? [
                { id: "pay_now", text: "Pay Now", style: "success", action: "proceed_to_payment" }
              ] : [],
              auto_trigger_payment: razorpayOrder ? true : false,
              flow_state: "payment_pending",
              message_type: "brand_owner_payment",
              visible_to: "brand_owner",
            },
          };
          break;

        case "accept_negotiated_price":
          // Brand owner accepts negotiated price → finalize and proceed to payment
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          // Determine agreed price
          const agreedFromNegotiation = data.price ? parseFloat(data.price) : (conversation.flow_data?.negotiated_price || null);

          // Update the final agreed amount in requests table
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({
                final_agreed_amount: agreedFromNegotiation,
                status: "finalized"
              })
              .eq("id", conversation.request_id);
          } else {
            // Fallback: upsert request by bid_id + influencer_id
            const { data: reqRow } = await supabaseAdmin
              .from("requests")
              .select("id")
              .eq("bid_id", conversation.bid_id)
              .eq("influencer_id", conversation.influencer_id)
              .single();
            if (reqRow) {
              await supabaseAdmin
                .from("requests")
                .update({
                  final_agreed_amount: agreedFromNegotiation,
                  status: "finalized"
                })
                .eq("id", reqRow.id);
              await supabaseAdmin
                .from("conversations")
                .update({ request_id: reqRow.id })
                .eq("id", conversationId);
            } else {
              const { data: newReq } = await supabaseAdmin
                .from("requests")
                .insert({
                  bid_id: conversation.bid_id,
                  influencer_id: conversation.influencer_id,
                  status: "finalized",
                  proposed_amount: agreedFromNegotiation,
                  final_agreed_amount: agreedFromNegotiation
                })
                .select()
                .single();
              if (newReq) {
                await supabaseAdmin
                  .from("conversations")
                  .update({ request_id: newReq.id })
                  .eq("id", conversationId);
              }
            }
          }

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `✅ **Negotiated Price Accepted**\n\nBrand owner has accepted your negotiated price of ₹${agreedFromNegotiation}. Please proceed with payment to complete the collaboration.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Payment Required**",
              subtitle: `Accepted amount: ₹${agreedFromNegotiation}`,
              buttons: [
                { id: "proceed_to_payment", text: "Proceed to Payment", style: "success", action: "proceed_to_payment", data: { amount: agreedFromNegotiation } }
              ],
              flow_state: "payment_pending",
              message_type: "brand_owner_payment",
              visible_to: "brand_owner",
            },
          };
          break;

        case "reject_negotiated_price":
          // Brand owner rejects negotiated price; allow influencer to try again
          newFlowState = "influencer_negotiation_input";
            newAwaitingRole = "influencer";

          const rejectedNegPrice = data.price ? parseFloat(data.price) : (conversation.flow_data?.negotiated_price || null);

            newMessage = {
              conversation_id: conversationId,
              sender_id: conversation.brand_owner_id,
              receiver_id: conversation.influencer_id,
            message: `❌ **Negotiated Price Rejected**\n\nBrand owner rejected the negotiated price of ₹${rejectedNegPrice}. Please propose another amount.`,
              message_type: "automated",
              action_required: true,
              action_data: {
              title: "💬 Propose New Price",
              subtitle: "Enter a different negotiated price.",
              input_field: { id: "negotiated_price", type: "number", placeholder: "Enter price in ₹", required: true, min: 0 },
              submit_button: { text: "Send Negotiated Price", style: "success" },
              flow_state: "influencer_negotiation_input",
              message_type: "influencer_negotiation_input",
              visible_to: "influencer"
            }
          };
          break;

        case "reject_final_work":
          // Brand owner rejects work (final rejection)
          newFlowState = "work_rejected";
          newAwaitingRole = null;
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `❌ **Work Rejected (Final)**\n\nUnfortunately, the work does not meet the requirements after ${conversation.flow_data?.revision_count || 0} revision(s).\n\n${data.feedback || data.rejection_reason || 'The work does not meet the project requirements.'}\n\nThe collaboration has been terminated.`,
            message_type: "automated",
            action_required: false,
          };

          // Update conversation to closed state
          await supabaseAdmin
            .from("conversations")
            .update({
              flow_state: "work_rejected",
              chat_status: "closed"
            })
            .eq("id", conversationId);
          break;

        case "approve_work":
          // Brand owner approves work - use handleWorkReview logic
          await this.handleWorkReview(conversationId, "approve_work", data.feedback || data.message || "");
          // handleWorkReview already sends messages and updates state, so we can return early
          return { success: true, message: "Work approved successfully" };

        case "request_revision":
          // Brand owner requests revision
          await this.handleWorkReview(conversationId, "request_revision", data.feedback || data.revision_feedback || data.message || "");
          // handleWorkReview already sends messages and updates state, so we can return early
          return { success: true, message: "Revision requested" };

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Update conversation state
      const updateData = {
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
      };

      // For proceed_to_payment, also update current_action_data with payment order
      if (action === "proceed_to_payment" && newMessage && newMessage.action_data) {
        // Normalize keys for frontend (both snake_case and camelCase)
        const a = { ...newMessage.action_data };
        if (a.razorpay_order && !a.razorpayOrder) a.razorpayOrder = a.razorpay_order;
        if (a.auto_trigger_payment !== undefined && a.autoTriggerPayment === undefined) {
          a.autoTriggerPayment = a.auto_trigger_payment;
        }
        updateData.current_action_data = a;
      }

      // Stop updating negotiation_round; negotiations can continue indefinitely

      console.log("🔄 [DEBUG] Updating conversation with data:", updateData);
      
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update(updateData)
        .eq("id", conversationId);

      if (updateError) {
        console.error("❌ [DEBUG] Failed to update conversation:", updateError);
        
        // Check if it's a constraint violation for flow_state
        if (updateError.message && updateError.message.includes("check constraint") && updateError.message.includes("flow_state")) {
          console.error("❌ [DEBUG] Flow state constraint violation! The database doesn't support the new flow state yet.");
          console.error("❌ [DEBUG] This means the database migration hasn't been applied.");
          console.error("❌ [DEBUG] Falling back to influencer_price_response state...");
          
          // Fallback to a supported state
          const fallbackUpdateData = {
            ...updateData,
            flow_state: "influencer_price_response"
          };
          
          const { error: fallbackError } = await supabaseAdmin
            .from("conversations")
            .update(fallbackUpdateData)
            .eq("id", conversationId);
            
          if (fallbackError) {
            console.error("❌ [DEBUG] Fallback update also failed:", fallbackError);
            throw new Error(`Failed to update conversation: ${updateError.message}`);
          } else {
            newFlowState = "influencer_price_response"; // Update the local variable too
            
            // Also update the message action_data to reflect the fallback state
            if (newMessage && newMessage.action_data) {
              newMessage.action_data.flow_state = "influencer_price_response";
            }
          }
        } else {
          throw new Error(`Failed to update conversation: ${updateError.message}`);
        }
      } else {
        console.log("✅ [DEBUG] Conversation updated successfully");
      }

      // Create messages (if any)
      let createdMessages = [];
      if (newMessage) {
        console.log("🧾 [AF] About to insert automated messages:", [newMessage]);
        const { data: msgs, error: messageError } = await supabaseAdmin
          .from("messages")
          .insert([newMessage])
          .select();

        if (messageError) {
          throw new Error(`Failed to create messages: ${messageError.message}`);
        }
        createdMessages = msgs || [];
        console.log("💾 [AF] Inserted automated messages:", createdMessages);
      }

      // Emit socket events for new messages
      if (createdMessages && createdMessages.length > 0) {
        createdMessages.forEach(msg => {
          this.emitAutomatedMessage(conversationId, msg);
        });
      }

      // Set current_action_data based on the action and flow state
      let currentActionData = {};
      
      if (action === "proceed_to_payment" && newMessage && newMessage.action_data) {
        const a = { ...newMessage.action_data };
        if (a.razorpay_order && !a.razorpayOrder) a.razorpayOrder = a.razorpay_order;
        if (a.auto_trigger_payment !== undefined && a.autoTriggerPayment === undefined) {
          a.autoTriggerPayment = a.auto_trigger_payment;
        }
        currentActionData = a;
      } else if (action === "approve_work") {
        // Show waiting status for both influencer and brand owner
        currentActionData = {
          title: "⏳ Waiting for Admin Payment",
          subtitle: "Work has been approved. Admin will process the final payment.",
          visible_to: "both", // Both influencer and brand owner should see this
          flow_state: newFlowState,
          message_type: "automated",
          awaiting_role: newAwaitingRole,
          status_message: "Final payment will be processed by our admin team shortly."
        };
      } else if (action === "request_revision") {
        // Show revision request status
        currentActionData = {
          title: "🔄 Revision Requested",
          subtitle: "Please review the feedback and resubmit your work.",
          visible_to: "influencer",
          flow_state: newFlowState,
          message_type: "automated",
          awaiting_role: newAwaitingRole
        };
      }

      const result = {
        success: true,
        conversation: {
          id: conversationId,
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
          current_action_data: currentActionData,
        },
        message: createdMessages[0],
      };
      console.log("📦 [AF] Result payload:", {
        flow_state: result.conversation.flow_state,
        awaiting_role: result.conversation.awaiting_role,
        has_message: !!result.message,
        message_preview: result.message ? {
          id: result.message.id,
          type: result.message.message_type,
          action_required: result.message.action_required,
          action_data_keys: result.message.action_data ? Object.keys(result.message.action_data) : null
        } : null,
        current_action_data_keys: currentActionData ? Object.keys(currentActionData) : null
      });

      // Send FCM notification to the target user
      const fcmService = require('../services/fcmService');
      const targetUserId = newAwaitingRole === 'influencer' ? conversation.influencer_id : conversation.brand_owner_id;
      if (targetUserId) {
        fcmService.sendFlowStateNotification(conversationId, targetUserId, newFlowState).then(result => {
          if (result.success) {
          } else {
            console.error(`❌ FCM brand owner action notification failed:`, result.error);
          }
        }).catch(error => {
          console.error(`❌ FCM brand owner action notification error:`, error);
        });
      }

      // Emit WebSocket events for real-time updates
      if (this.io) {
        try {
          // Emit conversation state change
          console.log(`🔀 [STATE] conversation_state_changed -> room:${conversationId} flow:${newFlowState} awaiting:${newAwaitingRole}`);
          this.io.to(`room:${conversationId}`).emit('conversation_state_changed', {
            conversation_id: conversationId,
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: 'automated',
            current_action_data: result.conversation.current_action_data,
            updated_at: new Date().toISOString()
          });

          // Emit new message to conversation room (chat:new)
          if (result.message) {
            console.log(`➡️ [EMIT] chat:new -> room:${conversationId} msg:${result.message.id}`);
            this.io.to(`room:${conversationId}`).emit('chat:new', { message: result.message });
          }

          // Emit global conversation list updates
          this.emitGlobalConversationUpdate(conversation, conversationId, {
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: 'automated',
            current_action_data: result.conversation.current_action_data,
            action: 'state_changed'
          });
        } catch (socketError) {
          console.error("❌ [DEBUG] WebSocket emit error:", socketError);
        }
      } else {
        console.warn("⚠️ [DEBUG] WebSocket not available for real-time updates");
      }

      return result;
    } catch (error) {
      console.error("❌ Failed to handle brand owner action:", error);
      throw error;
    }
  }

  /**
   * Handle influencer actions in the automated flow
   */
  async handleInfluencerAction(conversationId, action, data = {}) {
    try {

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Establish negotiation context variables once per handler
      const baseNegotiationHistory = Array.isArray(conversation.negotiation_history)
        ? conversation.negotiation_history
        : [];
      let currentRound = (typeof conversation.negotiation_round === 'number' && !Number.isNaN(conversation.negotiation_round))
        ? conversation.negotiation_round
        : baseNegotiationHistory.length;

      let newFlowState, newAwaitingRole, newMessage, auditMessage;

      switch (action) {
        case "negotiate_price":
          // Influencer requests negotiation; brand owner decides to accept/reject
          newFlowState = "brand_owner_negotiation";
          newAwaitingRole = "brand_owner";

          // Append to negotiation history
          const negotiationHistoryInit = Array.isArray(conversation.negotiation_history) ? conversation.negotiation_history : [];
          const negotiationStart = {
            event: "negotiate_price_requested",
            by: "influencer",
            at: new Date().toISOString()
          };

          await supabaseAdmin
            .from("conversations")
            .update({ negotiation_history: [...negotiationHistoryInit, negotiationStart] })
            .eq("id", conversationId);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: "🤝 Negotiation Requested\n\nInfluencer wants to negotiate the price. Do you want to proceed?",
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🤝 Negotiation Request",
              subtitle: "Accept to let influencer propose a new amount.",
              buttons: [
                { id: "accept_negotiation", text: "Accept Negotiation", style: "success", action: "accept_negotiation" },
                { id: "reject_negotiation", text: "Reject Negotiation", style: "danger", action: "reject_negotiation" }
              ],
              flow_state: "brand_owner_negotiation",
              message_type: "brand_owner_negotiation_request",
              visible_to: "brand_owner"
            }
          };
          break;
        case "accept":
        case "accept_connection":
          // Influencer accepts connection
          newFlowState = "brand_owner_details";
          newAwaitingRole = "brand_owner";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Connection Accepted**\n\nInfluencer has accepted your connection request. Please provide project details and requirements.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Project Details Input**",
              subtitle: "Enter the details and requirements of the project:",
              input_field: {
                id: "project_details",
                type: "textarea",
                placeholder:
                  "Enter project details, requirements, timeline, and any specific instructions...",
                required: true,
                maxLength: 1000,
              },
              submit_button: {
                text: "Send Project Details",
                style: "success",
              },
              flow_state: "brand_owner_details",
              message_type: "brand_owner_details_input",
              visible_to: "brand_owner",
            },
          };
          break;

        case "accept_project_details":
          // Influencer accepts the project details - now brand owner can provide price
          newFlowState = "brand_owner_pricing";
          newAwaitingRole = "brand_owner";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Project Accepted**\n\nInfluencer has accepted the project details. Please provide your price offer.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "💰 **Price Offer**",
              subtitle: "Enter your proposed price for this project:",
              input_field: {
                id: "price_offer",
                type: "number",
                placeholder: "Enter price in ₹",
                required: true,
                min: 0,
              },
              submit_button: {
                text: "Send Price Offer",
                style: "success",
              },
              flow_state: "brand_owner_pricing",
              message_type: "brand_owner_pricing_input",
              visible_to: "brand_owner",
            },
          };
          break;

        case "reject_project_details":
          // Influencer rejects the project details - conversation ends
          newFlowState = "project_rejected";
          newAwaitingRole = null;

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `❌ **Project Rejected**\n\nInfluencer has rejected the project details. The collaboration will not proceed.${data.rejection_reason ? `\n\nReason: ${data.rejection_reason}` : ''}`,
            message_type: "automated",
            action_required: false,
          };

          // Update conversation to closed state
          await supabaseAdmin
            .from("conversations")
            .update({
              flow_state: "project_rejected",
              chat_status: "closed"
            })
            .eq("id", conversationId);
          break;

        case "accept_price":
          // Influencer accepts the price offer - move to payment
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          const acceptedPrice = data.price ? parseFloat(data.price) : (conversation.flow_data?.price_offer || 0);

          // Update flow_data with agreed price
          const agreedFlowData = {
            ...(conversation.flow_data || {}),
            agreed_price: acceptedPrice,
            price_accepted_at: new Date().toISOString()
          };

          // Update request if exists
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({
                final_agreed_amount: acceptedPrice,
                status: "finalized"
              })
              .eq("id", conversation.request_id);
          }

          // Calculate payment breakdown
          const paymentBreakdown = await this.calculatePaymentBreakdown(acceptedPrice);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Price Accepted: ₹${acceptedPrice}**\n\nInfluencer has accepted the price offer. Please proceed with payment to start the collaboration.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "💳 **Payment Required**",
              subtitle: `Accepted price: ₹${acceptedPrice}\n\nPayment breakdown:\n• Total: ${paymentBreakdown.display.total}\n• Platform Fee: ${paymentBreakdown.display.commission}\n• Net to Influencer: ${paymentBreakdown.display.net_to_influencer}`,
              payment_breakdown: {
                total_amount: paymentBreakdown.total_amount_paise,
                commission_amount: paymentBreakdown.commission_amount_paise,
                commission_percentage: paymentBreakdown.commission_percentage,
                net_amount: paymentBreakdown.net_amount_paise,
                advance_amount: paymentBreakdown.advance_amount_paise,
                final_amount: paymentBreakdown.final_amount_paise,
                display: paymentBreakdown.display
              },
              buttons: [
                {
                  id: "proceed_to_payment",
                  text: "Proceed to Payment",
                  style: "success",
                  action: "proceed_to_payment",
                  data: { amount: acceptedPrice },
                },
              ],
              flow_state: "payment_pending",
              message_type: "brand_owner_payment",
              visible_to: "brand_owner",
            },
          };

          // Update flow_data with agreed price
          await supabaseAdmin
            .from("conversations")
            .update({ flow_data: agreedFlowData })
            .eq("id", conversationId);
          break;

        case "reject_price":
          // Influencer rejects the price offer - conversation ends
          newFlowState = "price_rejected";
          newAwaitingRole = null;

          const rejectedPrice = data.price ? parseFloat(data.price) : (conversation.flow_data?.price_offer || 0);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `❌ **Price Rejected**\n\nInfluencer has rejected the price offer of ₹${rejectedPrice}. The collaboration will not proceed.${data.rejection_reason ? `\n\nReason: ${data.rejection_reason}` : ''}`,
            message_type: "automated",
            action_required: false,
          };

          // Update conversation to closed state
            await supabaseAdmin
              .from("conversations")
              .update({
              flow_state: "price_rejected",
              chat_status: "closed"
            })
            .eq("id", conversationId);
          break;

        case "send_counter_offer":
          // Legacy alias -> treat as negotiated price send
          action = "send_negotiated_price";
          // fallthrough

        case "send_negotiated_price":
          // Influencer proposes a negotiated price
          newFlowState = "brand_owner_negotiation_review";
          newAwaitingRole = "brand_owner";

          const negotiatedPrice = data.price ? parseFloat(data.price) : null;
          if (!negotiatedPrice || negotiatedPrice <= 0) {
            throw new Error("Valid negotiated price is required");
          }

          // Append to negotiation history
          const negHist = Array.isArray(conversation.negotiation_history) ? conversation.negotiation_history : [];
          negHist.push({ event: "negotiated_price_submitted", by: "influencer", price: negotiatedPrice, at: new Date().toISOString() });

              await supabaseAdmin
                .from("conversations")
            .update({ negotiation_history: negHist, flow_data: { ...(conversation.flow_data || {}), negotiated_price: negotiatedPrice } })
                .eq("id", conversationId);

          const negotiatedBreakdown = await this.calculatePaymentBreakdown(negotiatedPrice);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `💬 **Negotiated Price Proposed: ₹${negotiatedPrice}**\n\nPlease review and accept or reject.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "💬 Review Negotiated Price",
              subtitle: `Proposed: ₹${negotiatedPrice}`,
              payment_breakdown: {
                total_amount: negotiatedBreakdown.total_amount_paise,
                commission_amount: negotiatedBreakdown.commission_amount_paise,
                commission_percentage: negotiatedBreakdown.commission_percentage,
                net_amount: negotiatedBreakdown.net_amount_paise,
                advance_amount: negotiatedBreakdown.advance_amount_paise,
                final_amount: negotiatedBreakdown.final_amount_paise,
                display: negotiatedBreakdown.display
              },
              buttons: [
                { id: "accept_negotiated_price", text: "Accept Negotiated Price", style: "success", action: "accept_negotiated_price", data: { price: negotiatedPrice } },
                { id: "reject_negotiated_price", text: "Reject Negotiated Price", style: "danger", action: "reject_negotiated_price", data: { price: negotiatedPrice } }
              ],
              flow_state: "brand_owner_negotiation_review",
              message_type: "brand_owner_negotiation_review",
              visible_to: "brand_owner"
            }
          };
          break;

        case "submit_work":
        case "resubmit_work":
          // Influencer submits work
          newFlowState = "work_submitted";
          newAwaitingRole = "brand_owner";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `📤 **Work Submitted**\n\nWork has been submitted for review. Please review and provide feedback.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "📋 **Work Review Required**",
              subtitle: "Please review the submitted work and take action.",
              buttons: [
                  {
                    id: "approve_work",
                    text: "Approve Work",
                    action: "approve_work",
                    style: "success"
                },
                {
                    id: "request_revision",
                    text: "Request Revision",
                    action: "request_revision",
                    style: "warning"
                }
              ],
              flow_state: "work_submitted",
              message_type: "work_review",
              visible_to: "brand_owner",
            },
          };

          // Update conversation to automated mode
          await supabaseAdmin
            .from("conversations")
            .update({
              chat_status: "automated"
            })
            .eq("id", conversationId);
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Update conversation state
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(
          `Failed to update conversation: ${updateError.message}`
        );
      }

      // Send FCM notification for flow state change
      const fcmService = require('../services/fcmService');
      const targetUserId = newAwaitingRole === 'influencer' ? conversation.influencer_id : conversation.brand_owner_id;
      if (targetUserId) {
        fcmService.sendFlowStateNotification(conversationId, targetUserId, newFlowState).then(result => {
          if (result.success) {
            console.log(`✅ FCM flow state notification sent: ${result.sent} successful, ${result.failed} failed`);
          } else {
            console.error(`❌ FCM flow state notification failed:`, result.error);
          }
        }).catch(error => {
          console.error(`❌ FCM flow state notification error:`, error);
        });
      }

      // Create messages
      const messagesToInsert = [newMessage];

      const { data: createdMessages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messagesToInsert)
        .select();

      if (messageError) {
        throw new Error(`Failed to create messages: ${messageError.message}`);
      }

      // Emit socket events for new messages
      if (createdMessages && createdMessages.length > 0) {
        createdMessages.forEach(msg => {
          this.emitAutomatedMessage(conversationId, msg);
        });
      }

      // Set current_action_data based on the action and flow state
      let currentActionData = {};
      
      if (action === "submit_work" || action === "resubmit_work") {
        // Show work submission status for brand owner
        currentActionData = {
          title: "📋 Work Submitted for Review",
          subtitle: "Please review the submitted work and take action.",
          visible_to: "brand_owner",
          flow_state: newFlowState,
          message_type: "automated",
          awaiting_role: newAwaitingRole,
          buttons: [
            {
              id: "approve_work",
              text: "Approve Work",
              action: "approve_work",
              style: "success"
            },
            {
              id: "request_revision",
              text: "Request Revision",
              action: "request_revision",
              style: "warning"
            }
          ]
        };
      }

      const result = {
        success: true,
        conversation: {
          id: conversationId,
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
          current_action_data: currentActionData,
        },
        message: createdMessages[0],
      };

      // Emit WebSocket events for real-time updates
      if (this.io) {
        try {
          // Get updated conversation for accurate state
          const { data: updatedConv } = await supabaseAdmin
            .from('conversations')
            .select('*')
            .eq('id', conversationId)
            .single();

          // Emit conversation state change to conversation room (standardized room name)
          console.log(`🔀 [STATE] conversation_state_changed -> room:${conversationId} flow:${newFlowState} awaiting:${newAwaitingRole}`);
          this.io.to(`room:${conversationId}`).emit('conversation_state_changed', {
            conversation_id: conversationId,
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: 'automated',
            current_action_data: result.conversation.current_action_data,
            updated_at: new Date().toISOString()
          });

          // Emit new message to conversation room (standardized event name)
          if (result.message) {
            console.log(`💬 [MSG] chat:new -> room:${conversationId} msg:${result.message.id}`);
            this.io.to(`room:${conversationId}`).emit('chat:new', {
              message: result.message
            });
            
            // Also emit as automated message
            this.emitAutomatedMessage(conversationId, result.message);
          }

          // Emit global conversation list updates
          this.emitGlobalConversationUpdate(conversation, conversationId, {
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: 'automated',
            current_action_data: result.conversation.current_action_data,
            action: 'state_changed',
            last_message: result.message ? {
              id: result.message.id,
              message: result.message.message,
              created_at: result.message.created_at,
              sender_id: result.message.sender_id
            } : undefined
          });

          // Emit conversations:upsert for both users (standardized list update)
          const conversationListUtils = require('./conversationListUpdates');
          if (result.message && updatedConv) {
            // Emit for influencer (submitter)
            const influencerPayload = await conversationListUtils.buildConversationsUpsertPayload({
              conversationId,
              currentUserId: conversation.influencer_id,
              lastMessage: result.message,
              conversation: updatedConv
            });
            conversationListUtils.emitConversationsUpsert(this.io, conversation.influencer_id, influencerPayload);

            // Emit for brand owner (reviewer)
            const brandOwnerPayload = await conversationListUtils.buildConversationsUpsertPayload({
              conversationId,
              currentUserId: conversation.brand_owner_id,
              lastMessage: result.message,
              conversation: updatedConv
            });
            conversationListUtils.emitConversationsUpsert(this.io, conversation.brand_owner_id, brandOwnerPayload);
          }

          console.log("✅ [DEBUG] WebSocket events emitted for influencer action:", conversationId);
        } catch (socketError) {
          console.error("❌ [DEBUG] WebSocket emit error:", socketError);
        }
      } else {
        console.warn("⚠️ [DEBUG] WebSocket not available for real-time updates");
      }

      return result;
    } catch (error) {
      console.error("❌ Failed to handle influencer action:", error);
      throw error;
    }
  }

  /**
   * Handle payment completion and transition to payment_completed state
   */
  async handlePaymentCompletion(conversationId, paymentData) {
    try {
      // Update conversation to payment_completed state
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Store previous state for state change event
      const previousState = {
        chat_status: conversation.chat_status,
        flow_state: conversation.flow_state,
        awaiting_role: conversation.awaiting_role
      };

      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "payment_completed",
          awaiting_role: "influencer", // Influencer needs to start work
          chat_status: "active",
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(
          `Failed to update conversation: ${updateError.message}`
        );
      }

      // Calculate payment breakdown for transparency
      const paymentBreakdown = await this.calculatePaymentBreakdown(paymentData.amount);

      // Create payment confirmation message
      const confirmationMessage = {
        conversation_id: conversationId,
        sender_id: SYSTEM_USER_ID,
        receiver_id: conversation.brand_owner_id,
        message: `✅ **Payment Completed Successfully: ₹${paymentData.amount}**\n\n` +
          `📊 **Payment Breakdown:**\n` +
          `• Total Amount: ${paymentBreakdown.display.total}\n` +
          `• Platform Fee: ${paymentBreakdown.display.commission}\n` +
          `• Influencer Net: ${paymentBreakdown.display.net_to_influencer}\n\n` +
          `💳 **Payment Schedule:**\n` +
          `• Advance (30%): ${paymentBreakdown.display.advance}\n` +
          `• Final (70%): ${paymentBreakdown.display.final}\n\n` +
          `The collaboration is now active and work can begin.`,
        message_type: "automated",
        action_required: false,
      };

      // Create work start message for influencer
      const workStartMessage = {
        conversation_id: conversationId,
        sender_id: SYSTEM_USER_ID,
        receiver_id: conversation.influencer_id,
        message: `🎯 **Work Phase Started**\n\nPayment has been completed! You can now start working on the project. Please begin your work and submit it when ready.`,
        message_type: "automated",
        action_required: true,
        action_data: {
          title: "🚀 **Start Working**",
          subtitle: "Payment completed! You can now begin your work on this project.",
          buttons: [
            {
              id: "start_work",
              text: "Start Working",
              style: "success",
              action: "start_work"
            }
          ],
          flow_state: "payment_completed",
          message_type: "work_start_prompt",
          visible_to: "influencer"
        }
      };

      const { data: messages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert([confirmationMessage, workStartMessage])
        .select();

      if (messageError) {
        throw new Error(
          `Failed to create confirmation messages: ${messageError.message}`
        );
      }

      return {
        success: true,
        conversation: {
          id: conversationId,
          flow_state: "payment_completed",
          awaiting_role: "influencer",
          chat_status: "active",
        },
        message: messages[0], // Confirmation message
        work_start_message: messages[1], // Work start message
      };
    } catch (error) {
      console.error("❌ Failed to handle payment completion:", error);
      throw error;
    }
  }

  /**
   * Handle work start - transition from payment_completed to work_in_progress
   */
  async handleWorkStart(conversationId) {
    try {
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Update conversation to work_in_progress state
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "work_in_progress",
          awaiting_role: "influencer", // Influencer is working
          chat_status: "active",
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(
          `Failed to update conversation: ${updateError.message}`
        );
      }

      // Create work started message
      const workStartedMessage = {
        conversation_id: conversationId,
        sender_id: conversation.influencer_id,
        receiver_id: conversation.brand_owner_id,
        message: `🚀 **Work Started**\n\nI've started working on the project. I'll submit the completed work when ready.`,
        message_type: "automated",
        action_required: false,
      };

      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(workStartedMessage)
        .select()
        .single();

      if (messageError) {
        throw new Error(
          `Failed to create work started message: ${messageError.message}`
        );
      }

      return {
        success: true,
        conversation: {
          id: conversationId,
          flow_state: "work_in_progress",
          awaiting_role: "influencer",
          chat_status: "active",
        },
        message: message,
      };
    } catch (error) {
      console.error("❌ Failed to handle work start:", error);
      throw error;
    }
  }

  /**
   * Handle work completion and transition to real-time chat
   */
  async handleWorkCompletion(conversationId) {
    try {
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Update conversation to real-time chat
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "real_time",
          awaiting_role: null, // No specific role needs to act
          chat_status: "active",
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(
          `Failed to update conversation: ${updateError.message}`
        );
      }

      // Create work completion message
      const workCompletionMessage = {
        conversation_id: conversationId,
        sender_id: SYSTEM_USER_ID,
        receiver_id: conversation.brand_owner_id,
        message: `🎉 **Work Completed Successfully**\n\nThe collaboration work has been completed! You can now communicate in real-time for any follow-up discussions.`,
        message_type: "automated",
        action_required: false,
      };

      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(workCompletionMessage)
        .select()
        .single();

      if (messageError) {
        throw new Error(
          `Failed to create work completion message: ${messageError.message}`
        );
      }

      return {
        success: true,
        conversation: {
          id: conversationId,
          flow_state: "real_time",
          awaiting_role: null,
          chat_status: "active",
        },
        message: message,
      };
    } catch (error) {
      console.error("❌ Failed to handle work completion:", error);
      throw error;
    }
  }

  /**
   * Get conversation flow context
   */
  async getConversationFlowContext(conversationId) {
    try {
      const { data: conversation, error } = await supabaseAdmin
        .from("conversations")
        .select("*, messages(*)")
        .eq("id", conversationId)
        .single();

      if (error || !conversation) {
        throw new Error("Conversation not found");
      }

      return {
        success: true,
        conversation: conversation,
        flow_state: conversation.flow_state,
        awaiting_role: conversation.awaiting_role,
        chat_status: conversation.chat_status,
      };
    } catch (error) {
      console.error("❌ Failed to get conversation flow context:", error);
      throw error;
    }
  }

  /**
   * Handle work submission in automated flow
   */
  async handleWorkSubmission(conversationId, submissionData) {
    try {
      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      // Check if this is a resubmission
      const isResubmission = conversation.flow_state === "work_in_progress" && conversation.revision_count > 0;
      
      // Update conversation to work_submitted state
      const updateData = {
        flow_state: "work_submitted",
        awaiting_role: "brand_owner",
        work_submission: submissionData,
        work_submitted: true,
        submission_date: submissionData.submitted_at
      };

      // If this is a resubmission, update revision history
      if (isResubmission) {
        const revisionHistory = conversation.revision_history || [];
        const lastRevision = revisionHistory[revisionHistory.length - 1];
        if (lastRevision) {
          lastRevision.submitted_at = new Date().toISOString();
          lastRevision.status = "submitted";
        }
        updateData.revision_history = revisionHistory;
      }

      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update(updateData)
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation: ${updateError.message}`);
      }

      // Handle attachments if provided
      let attachmentIds = [];
      if (submissionData.attachments && Array.isArray(submissionData.attachments) && submissionData.attachments.length > 0) {
        // If attachments are provided as IDs, use them directly
        attachmentIds = submissionData.attachments.filter(id => typeof id === 'string');
        console.log(`📎 [WORK SUBMISSION] Attachments linked: ${attachmentIds.length}`);
      }

      // Build message text with work submission details
      let messageText = `📤 **Work Submitted**${isResubmission ? ` (Revision ${conversation.revision_count || 0})` : ''}\n\n`;
      if (submissionData.deliverables) {
        messageText += `**Deliverables:** ${submissionData.deliverables}\n\n`;
      }
      if (submissionData.description) {
        messageText += `**Description:** ${submissionData.description}\n\n`;
      }
      if (submissionData.submission_notes) {
        messageText += `**Notes:** ${submissionData.submission_notes}\n\n`;
      }
      if (attachmentIds.length > 0) {
        messageText += `**Attachments:** ${attachmentIds.length} file(s) attached\n\n`;
      }

      // Create work submission message with attachments
      const messageInsertData = {
        conversation_id: conversationId,
        sender_id: conversation.influencer_id,
        receiver_id: conversation.brand_owner_id,
        message: messageText.trim(),
        message_type: "automated",
        action_required: true,
        action_data: {
          title: "🎯 **Work Review Required**",
          subtitle: "Please review the submitted work and provide feedback:",
          work_submission: {
            deliverables: submissionData.deliverables,
            description: submissionData.description,
            submission_notes: submissionData.submission_notes,
            submitted_at: submissionData.submitted_at,
            attachments_count: attachmentIds.length,
            attachment_ids: attachmentIds
          },
          buttons: (() => {
            const buttons = [
              {
                id: "approve_work",
                text: "Approve Work",
                action: "approve_work",
                style: "success"
              }
            ];

            // Check if this is final revision
            const currentRevisionCount = conversation.revision_count || 0;
            const maxRevisions = conversation.max_revisions || 3;
            const isFinalRevision = currentRevisionCount >= (maxRevisions - 1);

            if (isFinalRevision) {
              buttons.push({
                id: "reject_final_work",
                text: "Reject Work (Final)",
                action: "reject_final_work",
                style: "danger"
              });
            } else {
              buttons.push({
                id: "request_revision",
                text: "Request Revision",
                action: "request_revision",
                style: "warning"
              });
            }

            return buttons;
          })()
        }
      };

      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messageInsertData)
        .select()
        .single();

      if (messageError) {
        throw new Error(`Failed to create message: ${messageError.message}`);
      }

      // Link attachments to the message if provided
      if (attachmentIds.length > 0) {
        const attachmentLinks = attachmentIds.map(attachmentId => ({
          message_id: message.id,
          attachment_id: attachmentId
        }));

        const { error: linkError } = await supabaseAdmin
          .from("message_attachments")
          .insert(attachmentLinks);

        if (linkError) {
          console.error("⚠️ [WORK SUBMISSION] Failed to link attachments:", linkError);
          // Don't throw - message is created, attachments can be linked later
        } else {
          console.log(`✅ [WORK SUBMISSION] Linked ${attachmentIds.length} attachment(s) to message ${message.id}`);
        }
      }

      // Update request status to work_submitted if exists
      if (conversation.request_id) {
        await supabaseAdmin
          .from("requests")
          .update({
            status: "work_submitted",
            work_submission_link: submissionData.deliverables,
            work_description: submissionData.description,
            work_submission_date: submissionData.submitted_at
          })
          .eq("id", conversation.request_id);
      }

      // Emit socket events for real-time updates
      if (this.io) {
        try {
          // Get updated conversation
          const { data: updatedConv } = await supabaseAdmin
            .from('conversations')
            .select('*')
            .eq('id', conversationId)
            .single();

          // Emit conversation state change
          console.log(`🔀 [STATE] conversation_state_changed -> room:${conversationId} flow:work_submitted awaiting:brand_owner`);
          this.io.to(`room:${conversationId}`).emit('conversation_state_changed', {
            conversation_id: conversationId,
            flow_state: "work_submitted",
            awaiting_role: "brand_owner",
            chat_status: 'automated',
            current_action_data: message.action_data,
            updated_at: new Date().toISOString()
          });

          // Emit new message
          if (message) {
            console.log(`💬 [MSG] chat:new -> room:${conversationId} msg:${message.id}`);
            this.io.to(`room:${conversationId}`).emit('chat:new', {
              message: message
            });
            this.emitAutomatedMessage(conversationId, message);
          }

          // Emit conversation list updates for both users
          const conversationListUtils = require('./conversationListUpdates');
          if (message && updatedConv) {
            // Emit for influencer
            const influencerPayload = await conversationListUtils.buildConversationsUpsertPayload({
              conversationId,
              currentUserId: conversation.influencer_id,
              lastMessage: message,
              conversation: updatedConv
            });
            conversationListUtils.emitConversationsUpsert(this.io, conversation.influencer_id, influencerPayload);

            // Emit for brand owner
            const brandOwnerPayload = await conversationListUtils.buildConversationsUpsertPayload({
              conversationId,
              currentUserId: conversation.brand_owner_id,
              lastMessage: message,
              conversation: updatedConv
            });
            conversationListUtils.emitConversationsUpsert(this.io, conversation.brand_owner_id, brandOwnerPayload);
          }

          // Emit global conversation update
          this.emitGlobalConversationUpdate(conversation, conversationId, {
            flow_state: "work_submitted",
            awaiting_role: "brand_owner",
            chat_status: 'automated',
            action: 'work_submitted',
            last_message: message ? {
              id: message.id,
              message: message.message,
              created_at: message.created_at,
              sender_id: message.sender_id
            } : undefined
          });

          console.log("✅ [DEBUG] Socket events emitted for work submission:", conversationId);
        } catch (socketError) {
          console.error("❌ [DEBUG] Socket emit error in handleWorkSubmission:", socketError);
        }
      }

      return {
        success: true,
        flow_state: "work_submitted",
        awaiting_role: "brand_owner",
        message: message
      };
    } catch (error) {
      console.error("❌ Failed to handle work submission:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle work review in automated flow
   */
  async handleWorkReview(conversationId, action, feedback = "") {
    try {
      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      let newFlowState, newAwaitingRole, messageText, actionData;

      if (action === "approve_work") {
        // Check if admin payment tracking exists - if yes, await admin to process final payment
        const { data: adminPaymentRecord } = await supabaseAdmin
          .from("admin_payment_tracking")
          .select("*")
          .eq("conversation_id", conversationId)
          .eq("advance_payment_status", "admin_confirmed")
          .eq("final_payment_status", "pending")
          .single();

        if (adminPaymentRecord) {
          // Admin payment flow: transition to admin final payment pending
          newFlowState = "admin_final_payment_pending";
          newAwaitingRole = "admin";
          
          const finalAmount = adminPaymentRecord.final_amount_paise / 100;
          const totalAmount = adminPaymentRecord.total_amount_paise / 100;
          const commissionAmount = adminPaymentRecord.commission_amount_paise / 100;
          
          messageText = `✅ **Work Approved!**\n\n🎉 Great work! The collaboration work has been approved.${feedback ? `\n\n**Feedback:** ${feedback}` : ''}\n\n💳 **Final Payment Required**\n\n💰 **Final Amount:** ₹${finalAmount}\n💼 **Total Commission:** ₹${commissionAmount}\n💵 **Total Paid:** ₹${totalAmount}\n\n⏳ **Status:** Waiting for admin to process final payment...`;
          
          actionData = {
            title: "✅ **Work Approved - Final Payment Required**",
            subtitle: "Please process the final payment to complete the collaboration:",
            payment_breakdown: {
              total_amount: totalAmount,
              commission_amount: commissionAmount,
              net_amount: adminPaymentRecord.net_amount_paise / 100,
              advance_amount: adminPaymentRecord.advance_amount_paise / 100,
              final_amount: finalAmount,
              commission_percentage: adminPaymentRecord.commission_percentage
            },
            admin_payment_tracking_id: adminPaymentRecord.id,
            buttons: [
              {
                id: "process_final_payment",
                text: "Process Final Payment",
                action: "process_final_payment",
                style: "success",
                visible_to: ["admin"]
              }
            ]
          };
        } else {
          // Direct payment flow: close conversation
          newFlowState = "work_approved";
          newAwaitingRole = null; // Work completed, no further action needed
          
          messageText = `✅ **Work Approved!**\n\n🎉 Great work! The collaboration has been completed successfully.${feedback ? `\n\n**Feedback:** ${feedback}` : ''}\n\n✨ **Collaboration Status: CLOSED**`;
          
          actionData = {
            title: "🎉 **Collaboration Completed**",
            subtitle: "The work has been approved and the collaboration is now complete. This conversation is closed.",
            is_closed: true,
            chat_status: "closed",
            buttons: []
          };

          // Update request status to completed
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({ status: "completed" })
              .eq("id", conversation.request_id);
          }

          // Update campaign/bid status to closed
          if (conversation.campaign_id) {
            await supabaseAdmin
              .from("campaigns")
              .update({ status: "closed" })
              .eq("id", conversation.campaign_id);
          } else if (conversation.bid_id) {
            await supabaseAdmin
              .from("bids")
              .update({ status: "closed" })
              .eq("id", conversation.bid_id);
          }

          // Mark conversation as CLOSED
          await supabaseAdmin
            .from("conversations")
            .update({
              chat_status: "closed",
              flow_state: "work_approved"
            })
            .eq("id", conversationId);

          // Release escrow funds using proper escrow service
          if (conversation.request_id) {
            const escrowService = require('../services/escrowService');
            const escrowResult = await escrowService.releaseEscrowFunds(
              conversationId,
              'Work approved by brand owner'
            );

            if (!escrowResult.success) {
              console.error("Escrow release error:", escrowResult.error);
            } else {
              console.log("✅ Escrow funds released successfully");
            }
          }
        }

        // Update conversation state
        await supabaseAdmin
          .from("conversations")
          .update({
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: adminPaymentRecord ? "real_time" : "closed",
            updated_at: new Date().toISOString()
          })
          .eq("id", conversationId);

        // Emit stats updates after status change
        if (this.io && conversation.brand_owner_id && conversation.influencer_id) {
          const { emitStatsUpdatesToBothUsers } = require('./statsUpdates');
          await emitStatsUpdatesToBothUsers(conversation.brand_owner_id, conversation.influencer_id, this.io);
        }

      } else if (action === "request_revision") {
        // Get current revision count
        const currentRevisionCount = conversation.revision_count || 0;
        const maxRevisions = conversation.max_revisions || 3;
        
        // Check if this is the final revision
        const isFinalRevision = currentRevisionCount >= (maxRevisions - 1);
        
        newFlowState = isFinalRevision ? "work_final_review" : "work_in_progress";
        newAwaitingRole = "influencer";
        
        const revisionText = isFinalRevision 
          ? `🔄 **Final Revision Requested** (${currentRevisionCount + 1}/${maxRevisions})\n\nThis is your final chance to make changes. Please address the feedback and resubmit your work:${feedback ? `\n\n**Feedback:** ${feedback}` : ''}`
          : `🔄 **Revision Requested** (${currentRevisionCount + 1}/${maxRevisions})\n\nPlease make the following changes and resubmit your work:${feedback ? `\n\n**Feedback:** ${feedback}` : ''}`;
        
        messageText = revisionText;
        
        actionData = {
          title: isFinalRevision ? "⚠️ **Final Revision Required**" : "📝 **Work Revision Required**",
          subtitle: isFinalRevision 
            ? "This is your final revision. Please address all feedback carefully:"
            : "Please address the feedback and resubmit your work:",
          buttons: [
            {
              id: "resubmit_work",
              text: isFinalRevision ? "Submit Final Revision" : "Resubmit Work",
              action: "resubmit_work",
              style: isFinalRevision ? "warning" : "primary"
            }
          ]
        };
      } else if (action === "reject_final_work") {
        newFlowState = "work_rejected";
        newAwaitingRole = "influencer";
        
        messageText = `❌ **Work Rejected**\n\nAfter ${conversation.revision_count || 0} revision attempts, the work has been rejected. You can choose to continue working or reject the project.${feedback ? `\n\n**Final Feedback:** ${feedback}` : ''}`;
        
        actionData = {
          title: "❌ **Work Rejected**",
          subtitle: "The work has been rejected after maximum revisions. Choose your next action:",
          buttons: [
            {
              id: "agree_continue_work",
              text: "Agree to Continue Working",
              action: "agree_continue_work",
              style: "primary"
            },
            {
              id: "reject_project",
              text: "Reject Project",
              action: "reject_project",
              style: "danger"
            }
          ]
        };
      } else {
        throw new Error(`Unknown review action: ${action}`);
      }

      // Prepare update data
      const updateData = {
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
        work_status: action === "approve_work" ? "approved" : "revision_requested"
      };

      // Handle chat_status based on action
      if (action === "approve_work") {
        // When work is approved, explicitly set chat_status to closed
        updateData.chat_status = "closed";
      } else if (action === "request_revision") {
        // For revision requests, ensure chat_status remains 'real_time' (was already real_time during work)
        updateData.chat_status = "real_time";
      }
      // For other actions (reject_final_work), preserve existing chat_status (don't update it)

      // Update revision count if requesting revision
      if (action === "request_revision") {
        const currentRevisionCount = conversation.revision_count || 0;
        updateData.revision_count = currentRevisionCount + 1;
        
        // Add to revision history
        const revisionHistory = conversation.revision_history || [];
        revisionHistory.push({
          revision_number: currentRevisionCount + 1,
          requested_at: new Date().toISOString(),
          feedback: feedback || "",
          status: "requested"
        });
        updateData.revision_history = revisionHistory;
      }

      // Update conversation state
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update(updateData)
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation: ${updateError.message}`);
      }

      // Create review message
      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: conversation.brand_owner_id,
          receiver_id: conversation.influencer_id,
          message: messageText,
          message_type: "automated", // Fixed: Changed from "system" to "automated"
          action_required: actionData.buttons.length > 0,
          action_data: actionData
        })
        .select()
        .single();

      if (messageError) {
        throw new Error(`Failed to create message: ${messageError.message}`);
      }

      // Emit socket events for real-time updates
      if (this.io) {
        try {
          // Determine correct chat_status based on flow state
          // When work is approved, chat_status is 'closed'
          // For revision requests (work_in_progress), keep 'real_time' (was already real_time)
          // For other states, use 'automated' 
          let chatStatusForEmit;
          if (newFlowState === 'work_approved') {
            chatStatusForEmit = 'closed';
          } else if (newFlowState === 'work_in_progress' || newFlowState === 'work_final_review') {
            // During work (including revisions), chat should be real_time
            chatStatusForEmit = 'real_time';
          } else {
            // For other states, check what chat_status should be (preserve if was real_time)
            chatStatusForEmit = updateData.chat_status || conversation.chat_status || 'automated';
          }
          
          // Emit conversation state change to conversation room
          console.log(`🔀 [STATE] conversation_state_changed -> room:${conversationId} flow:${newFlowState} awaiting:${newAwaitingRole} chat_status:${chatStatusForEmit}`);
          this.io.to(`room:${conversationId}`).emit('conversation_state_changed', {
            conversation_id: conversationId,
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: chatStatusForEmit,
            current_action_data: actionData,
            is_closed: newFlowState === 'work_approved',
            updated_at: new Date().toISOString()
          });

          // Emit new message to conversation room
          if (message) {
            console.log(`💬 [MSG] chat:new -> room:${conversationId} msg:${message.id}`);
            this.io.to(`room:${conversationId}`).emit('chat:new', {
              message: message
            });
            
            // Also emit as automated message
            this.emitAutomatedMessage(conversationId, message);
          }

          // Emit global conversation list updates to both users
          // Use the same chat_status logic as above
          this.emitGlobalConversationUpdate(conversation, conversationId, {
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: chatStatusForEmit,
            current_action_data: actionData,
            is_closed: newFlowState === 'work_approved',
            action: 'state_changed',
            last_message: message ? {
              id: message.id,
              message: message.message,
              created_at: message.created_at,
              sender_id: message.sender_id
            } : undefined
          });

          // Emit conversations:upsert for both users
          const conversationListUtils = require('./conversationListUpdates');
          if (message) {
            // Get updated conversation
            const { data: updatedConv } = await supabaseAdmin
              .from('conversations')
              .select('*')
              .eq('id', conversationId)
              .single();

            if (updatedConv) {
              // Emit for brand owner
              const brandOwnerPayload = await conversationListUtils.buildConversationsUpsertPayload({
                conversationId,
                currentUserId: conversation.brand_owner_id,
                lastMessage: message,
                conversation: updatedConv
              });
              conversationListUtils.emitConversationsUpsert(this.io, conversation.brand_owner_id, brandOwnerPayload);

              // Emit for influencer
              const influencerPayload = await conversationListUtils.buildConversationsUpsertPayload({
                conversationId,
                currentUserId: conversation.influencer_id,
                lastMessage: message,
                conversation: updatedConv
              });
              conversationListUtils.emitConversationsUpsert(this.io, conversation.influencer_id, influencerPayload);
            }
          }

          console.log("✅ [DEBUG] Socket events emitted for work review:", conversationId);
        } catch (socketError) {
          console.error("❌ [DEBUG] Socket emit error in handleWorkReview:", socketError);
        }
      }

      // Send FCM notification to influencer
      const fcmService = require('../services/fcmService');
      const targetUserId = newAwaitingRole === 'influencer' ? conversation.influencer_id : conversation.brand_owner_id;
      if (targetUserId) {
        fcmService.sendFlowStateNotification(
          conversationId, 
          targetUserId, 
          newFlowState,
          messageText
        ).then(result => {
          if (result.success) {
            console.log(`✅ FCM work review notification sent: ${result.sent} successful, ${result.failed} failed`);
          } else {
            console.error(`❌ FCM work review notification failed:`, result.error);
          }
        }).catch(error => {
          console.error(`❌ FCM work review notification error:`, error);
        });
      }

      return {
        success: true,
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
        message: message
      };
    } catch (error) {
      console.error("❌ Failed to handle work review:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle admin actions in automated flow
   */
  async handleAdminAction(conversationId, action, data = {}) {
    try {
      const conversation = await this.getConversation(conversationId);
      
      switch (action) {
        case 'receive_brand_owner_payment':
          return await this.receiveBrandOwnerPayment(conversationId, data);
        case 'release_advance':
          return await this.releaseAdvance(conversationId, data);
        case 'release_final':
          return await this.releaseFinal(conversationId, data);
        case 'refund_final':
          return await this.refundFinal(conversationId, data);
        case 'force_close':
          return await this.forceCloseConversation(conversationId, data);
        default:
          throw new Error(`Unknown admin action: ${action}`);
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Receive brand owner payment (admin action)
   */
  async receiveBrandOwnerPayment(conversationId, data) {
    try {
      const { amount, currency = "INR", reference, attachments = [], notes, commission_percent } = data;
      
      if (!amount || amount <= 0) {
        throw new Error("Valid amount required");
      }

      // Track brand owner payment to admin (for audit)
      const payload = {
        conversation_id: conversationId,
        direction: "in",
        type: "credit",
        status: "completed",
        amount: amount,
        amount_paise: Math.round(Number(amount) * 100),
        notes: notes || `Payment received for conversation ${conversationId}`,
        payment_stage: "received",
        admin_payment_tracking_id: reference || null,
      };

      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("transactions")
        .insert(payload)
        .select()
        .single();
      
      if (txnErr) {
        throw new Error(`Transaction failed: ${txnErr.message}`);
      }

      // Create automated message with optional screenshot
      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: SYSTEM_USER_ID,
          receiver_id: null,
          message: `Admin recorded payment from brand owner: ₹${amount}${commission_percent ? ` (commission ${commission_percent}%)` : ""}`,
          message_type: "system_payment_update",
          media_url: attachments.length > 0 ? attachments[0].url : null,
          attachment_metadata: attachments,
          action_required: false,
          metadata: {
            payment_action: 'receive_payment',
            amount: amount,
            commission_percent: commission_percent,
            reference: reference
          }
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error creating automated message for payment receive:', messageError);
      }

      // Emit WebSocket events
      if (this.io) {
        this.io.to(`conversation_${conversationId}`).emit('new_message', {
          conversation_id: conversationId,
          message: message
        });
      }

      return {
        success: true,
        conversation: await this.getConversation(conversationId),
        message: message,
        transaction: txn
      };
    } catch (error) {
      console.error('Error in receiveBrandOwnerPayment:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Release advance payment (admin action)
   */
  async releaseAdvance(conversationId, data) {
    try {
      const { amount, currency = "INR", payout_reference, attachments = [], notes, commission_percent } = data;
      
      if (!amount || amount <= 0) {
        throw new Error("Valid amount required");
      }

      const conversation = await this.getConversation(conversationId);

      // Record payout to influencer
      const payout = {
        conversation_id: conversationId,
        direction: "out",
        type: "debit",
        status: "completed",
        amount: amount,
        amount_paise: Math.round(Number(amount) * 100),
        notes: notes || `Advance released to influencer for conversation ${conversationId}`,
        payment_stage: "advance",
        admin_payment_tracking_id: payout_reference || null,
        receiver_id: conversation.influencer_id,
        sender_id: SYSTEM_USER_ID,
      };

      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("transactions")
        .insert(payout)
        .select()
        .single();
      
      if (txnErr) {
        throw new Error(`Transaction failed: ${txnErr.message}`);
      }

      // Update conversation state to work_in_progress
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "work_in_progress",
          awaiting_role: "influencer",
          updated_at: new Date().toISOString()
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation state: ${updateError.message}`);
      }

      // Create automated message
      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.influencer_id,
          message: `✅ **Advance Payment Released!**\n\nAdmin has released an advance payment of ₹${amount} to the influencer. The conversation is now in **Work In Progress** state.`,
          message_type: "system_payment_update",
          media_url: attachments.length > 0 ? attachments[0].url : null,
          attachment_metadata: attachments,
          action_required: false,
          metadata: {
            payment_action: 'release_advance',
            amount: amount,
            payout_reference: payout_reference,
            commission_percent: commission_percent
          }
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error creating automated message for advance release:', messageError);
      }

      // Emit WebSocket events
      if (this.io) {
        this.io.to(`conversation_${conversationId}`).emit('conversation_state_changed', {
          conversation_id: conversationId,
          previous_state: conversation.flow_state,
          new_state: "work_in_progress",
          awaiting_role: "influencer",
          reason: "release_advance",
          timestamp: new Date().toISOString()
        });

        this.io.to(`conversation_${conversationId}`).emit('new_message', {
          conversation_id: conversationId,
          message: message
        });

        // Notify both users about the payment
        this.io.to(`user_${conversation.brand_owner_id}`).emit('notification', {
          type: 'payment_update',
          data: { conversation_id: conversationId, message: `Advance payment of ₹${amount} released to influencer.` }
        });
        this.io.to(`user_${conversation.influencer_id}`).emit('notification', {
          type: 'payment_update',
          data: { conversation_id: conversationId, message: `You received an advance payment of ₹${amount}. Start working!` }
        });
      }

      const updatedConversation = await this.getConversation(conversationId);

      return {
        success: true,
        conversation: updatedConversation,
        message: message,
        transaction: txn
      };
    } catch (error) {
      console.error('Error in releaseAdvance:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Release final payment (admin action)
   */
  async releaseFinal(conversationId, data) {
    try {
      const { amount, currency = "INR", payout_reference, attachments = [], notes, commission_percent } = data;
      
      if (!amount || amount <= 0) {
        throw new Error("Valid amount required");
      }

      const conversation = await this.getConversation(conversationId);
      
      if (conversation.flow_state !== "admin_final_payment_pending") {
        throw new Error("Final can be released only after work is approved and awaiting admin payment");
      }

      // Record payout to influencer
      const payout = {
        conversation_id: conversationId,
        direction: "out",
        type: "debit",
        status: "completed",
        amount: amount,
        amount_paise: Math.round(Number(amount) * 100),
        notes: notes || `Final payment released to influencer for conversation ${conversationId}`,
        payment_stage: "final",
        admin_payment_tracking_id: payout_reference || null,
        receiver_id: conversation.influencer_id,
        sender_id: SYSTEM_USER_ID,
      };

      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("transactions")
        .insert(payout)
        .select()
        .single();
      
      if (txnErr) {
        throw new Error(`Transaction failed: ${txnErr.message}`);
      }

      // Move state to admin_final_payment_complete first, then to closed
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "admin_final_payment_complete",
          awaiting_role: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation state: ${updateError.message}`);
      }

      // Create automated message
      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.influencer_id,
          message: `🎉 **Final Payment Released!**\n\nAdmin has released the final payment of ₹${amount} to the influencer. The conversation is now **Closed**.`,
          message_type: "system_payment_update",
          media_url: attachments.length > 0 ? attachments[0].url : null,
          attachment_metadata: attachments,
          action_required: false,
          metadata: {
            payment_action: 'release_final',
            amount: amount,
            payout_reference: payout_reference,
            commission_percent: commission_percent
          }
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error creating automated message for final release:', messageError);
      }

      // Now transition to closed state
      const { error: closeError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "closed",
          updated_at: new Date().toISOString()
        })
        .eq("id", conversationId);

      if (closeError) {
        console.error('Error transitioning to closed state:', closeError);
      }

      // Emit WebSocket events
      if (this.io) {
        this.io.to(`conversation_${conversationId}`).emit('conversation_state_changed', {
          conversation_id: conversationId,
          previous_state: conversation.flow_state,
          new_state: "closed",
          awaiting_role: null,
          reason: "release_final",
          timestamp: new Date().toISOString()
        });

        this.io.to(`conversation_${conversationId}`).emit('new_message', {
          conversation_id: conversationId,
          message: message
        });

        // Notify both users about the payment
        this.io.to(`user_${conversation.brand_owner_id}`).emit('notification', {
          type: 'payment_update',
          data: { conversation_id: conversationId, message: `Final payment of ₹${amount} released to influencer.` }
        });
        this.io.to(`user_${conversation.influencer_id}`).emit('notification', {
          type: 'payment_update',
          data: { conversation_id: conversationId, message: `You received the final payment of ₹${amount}. Great work!` }
        });
      }

      const updatedConversation = await this.getConversation(conversationId);

      return {
        success: true,
        conversation: updatedConversation,
        message: message,
        transaction: txn
      };
    } catch (error) {
      console.error('Error in releaseFinal:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refund final payment (admin action)
   */
  async refundFinal(conversationId, data) {
    try {
      const { amount, currency = "INR", refund_reference, attachments = [], notes, commission_percent } = data;
      
      if (!amount || amount <= 0) {
        throw new Error("Valid amount required");
      }

      const conversation = await this.getConversation(conversationId);

      // Record refund to brand owner
      const refund = {
        conversation_id: conversationId,
        direction: "out",
        type: "debit",
        status: "completed",
        amount: amount,
        amount_paise: Math.round(Number(amount) * 100),
        notes: notes || `Refund processed for conversation ${conversationId}`,
        payment_stage: "refund",
        admin_payment_tracking_id: refund_reference || null,
        receiver_id: conversation.brand_owner_id,
        sender_id: SYSTEM_USER_ID,
      };

      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("transactions")
        .insert(refund)
        .select()
        .single();
      
      if (txnErr) {
        throw new Error(`Transaction failed: ${txnErr.message}`);
      }

      // Move state to closed
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "closed",
          awaiting_role: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation state: ${updateError.message}`);
      }

      // Create automated message
      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: SYSTEM_USER_ID,
          receiver_id: conversation.brand_owner_id,
          message: `💰 **Refund Processed!**\n\nAdmin has processed a refund of ₹${amount} to the brand owner. The conversation is now **Closed**.`,
          message_type: "system_payment_update",
          media_url: attachments.length > 0 ? attachments[0].url : null,
          attachment_metadata: attachments,
          action_required: false,
          metadata: {
            payment_action: 'refund_final',
            amount: amount,
            refund_reference: refund_reference,
            commission_percent: commission_percent
          }
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error creating automated message for refund:', messageError);
      }

      // Emit WebSocket events
      if (this.io) {
        this.io.to(`conversation_${conversationId}`).emit('conversation_state_changed', {
          conversation_id: conversationId,
          previous_state: conversation.flow_state,
          new_state: "closed",
          awaiting_role: null,
          reason: "refund_final",
          timestamp: new Date().toISOString()
        });

        this.io.to(`conversation_${conversationId}`).emit('new_message', {
          conversation_id: conversationId,
          message: message
        });

        // Notify both users about the refund
        this.io.to(`user_${conversation.brand_owner_id}`).emit('notification', {
          type: 'payment_update',
          data: { conversation_id: conversationId, message: `You received a refund of ₹${amount}.` }
        });
        this.io.to(`user_${conversation.influencer_id}`).emit('notification', {
          type: 'payment_update',
          data: { conversation_id: conversationId, message: `A refund of ₹${amount} was processed to the brand owner.` }
        });
      }

      const updatedConversation = await this.getConversation(conversationId);

      return {
        success: true,
        conversation: updatedConversation,
        message: message,
        transaction: txn
      };
    } catch (error) {
      console.error('Error in refundFinal:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Force close conversation (admin action)
   */
  async forceCloseConversation(conversationId, data) {
    try {
      const { reason, notes } = data;
      const conversation = await this.getConversation(conversationId);

      // Move state to closed
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "closed",
          awaiting_role: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(`Failed to update conversation state: ${updateError.message}`);
      }

      // Create automated message
      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: SYSTEM_USER_ID,
          receiver_id: null,
          message: `🔒 **Conversation Closed by Admin**\n\n${reason || 'Admin has closed this conversation.'}${notes ? `\n\nNote: ${notes}` : ''}`,
          message_type: "system_payment_update",
          action_required: false,
          metadata: {
            payment_action: 'force_close',
            reason: reason,
            notes: notes
          }
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error creating automated message for force close:', messageError);
      }

      // Emit WebSocket events
      if (this.io) {
        this.io.to(`conversation_${conversationId}`).emit('conversation_state_changed', {
          conversation_id: conversationId,
          previous_state: conversation.flow_state,
          new_state: "closed",
          awaiting_role: null,
          reason: "force_close",
          timestamp: new Date().toISOString()
        });

        this.io.to(`conversation_${conversationId}`).emit('new_message', {
          conversation_id: conversationId,
          message: message
        });

        // Notify both users
        this.io.to(`user_${conversation.brand_owner_id}`).emit('notification', {
          type: 'conversation_closed',
          data: { conversation_id: conversationId, message: 'Conversation closed by admin.' }
        });
        this.io.to(`user_${conversation.influencer_id}`).emit('notification', {
          type: 'conversation_closed',
          data: { conversation_id: conversationId, message: 'Conversation closed by admin.' }
        });
      }

      const updatedConversation = await this.getConversation(conversationId);

      return {
        success: true,
        conversation: updatedConversation,
        message: message,
      };
    } catch (error) {
      console.error('Error in forceCloseConversation:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unified conversation action handler
   */
  async handleConversationAction(conversationId, action, data = {}, userRole, userId) {
    try {
      // Validate role permissions
      const roleActions = {
        'influencer': ['submit_work', 'resubmit_work', 'accept_price', 'reject_price', 'negotiate_price'],
        'brand_owner': ['request_revision', 'approve_work', 'accept_price', 'reject_price', 'negotiate_price'],
        'admin': ['receive_brand_owner_payment', 'release_advance', 'release_final', 'refund_final', 'force_close']
      };

      if (!roleActions[userRole]?.includes(action)) {
        throw new Error(`Role ${userRole} cannot perform action ${action}`);
      }

      // Get conversation and validate state
      const conversation = await this.getConversation(conversationId);
      
      // Route to appropriate handler
      let result;
      switch (userRole) {
        case 'influencer':
          result = await this.handleInfluencerAction(conversationId, action, data);
          break;
        case 'brand_owner':
          result = await this.handleBrandOwnerAction(conversationId, action, data);
          break;
        case 'admin':
          result = await this.handleAdminAction(conversationId, action, data);
          break;
        default:
          throw new Error(`Unknown role: ${userRole}`);
      }

      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new AutomatedFlowService();
