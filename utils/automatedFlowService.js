const { supabaseAdmin } = require("../supabase/client");

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
      this.io.to(`global_${conversation.brand_owner_id}`).emit('conversation_list_updated', {
        conversation_id: conversationId,
        ...updateData,
        timestamp: new Date().toISOString()
      });

      this.io.to(`global_${conversation.influencer_id}`).emit('conversation_list_updated', {
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

      // Create audit message for brand owner
      const auditMessage = {
        conversation_id: conversation.id,
        sender_id: SYSTEM_USER_ID,
        receiver_id: bid.created_by,
        message: `✅ **Connection Request Sent**\n\nYou have sent a connection request to **${influencer.name}** for your bid **"${bid.title}"**. The influencer will now review and respond to your request.`,
        message_type: "audit",
        action_required: false,
      };

      // Insert only the initial actionable message (no audit messages)
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
        audit_message: messages[1], // Audit message
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

      // Create audit message
      const auditMessage = {
        conversation_id: conversation.id,
        sender_id: SYSTEM_USER_ID,
        receiver_id: campaign.created_by,
        message: `📋 **Campaign Connection Audit**

- Campaign: ${campaign.title} (ID: ${campaignId})
- Brand Owner: ${campaign.users.name}
- Influencer: ${influencer.name}
- Connection established at: ${new Date().toISOString()}
- Flow State: influencer_responding
- Awaiting: influencer response`,
        message_type: "audit",
        action_required: false,
        is_automated: true,
      };

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

      // Send FCM notification to influencer
      const fcmService = require('../services/fcmService');
      fcmService.sendFlowStateNotification(
        conversation.id, 
        influencerId, 
        "influencer_responding",
        "You have a new campaign connection request"
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
        message: messages[0], // Initial message
        audit_message: messages[1], // Audit message
        flow_state: "influencer_responding", // Already in influencer_responding state
        awaiting_role: "influencer", // Influencer needs to respond
        is_existing: false,
        status_message: "New campaign conversation created successfully",
      };
    } catch (error) {
      console.error("❌ Failed to initialize campaign conversation:", error);
      throw error;
    }
  }

  /**
   * Handle brand owner actions in the automated flow
   */
  async handleBrandOwnerAction(conversationId, action, data = {}) {
    try {
      
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
        case "connect":
          // This action is no longer needed - connection is sent immediately on initialization
          // Return error indicating this action is not valid
          throw new Error(
            "Connect action is not needed. Connection request is sent automatically when conversation is initialized."
          );
          break;

        case "send_project_details":
          // Brand owner sends project details
          newFlowState = "influencer_reviewing";
          newAwaitingRole = "influencer";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `📋 **Project Details & Requirements**\n\n${data.details}\n\nPlease review the requirements and respond.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Project Review**",
              subtitle:
                "Review the project requirements and choose your response:",
              buttons: [
                {
                  id: "accept_project",
                  text: "Accept Project Requirements",
                  style: "success",
                  action: "accept_project",
                },
                {
                  id: "deny_project",
                  text: "Deny Project Requirements",
                  style: "danger",
                  action: "deny_project",
                },
              ],
              flow_state: "influencer_reviewing",
              message_type: "influencer_project_response",
              visible_to: "influencer",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Project Details Sent**\n\nYou have sent the project details and requirements to the influencer.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "send_price_offer":
          // Brand owner sends price offer
          
          if (!data.price || data.price === undefined) {
            return {
              success: false,
              error: "Price is required for price offer",
            };
          }
          
          newFlowState = "influencer_price_response";
          newAwaitingRole = "influencer";

          // Persist the offered price as requests.proposed_amount
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({
                proposed_amount: data.price ? parseFloat(data.price) : null,
                status: "negotiating"
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
                  proposed_amount: data.price ? parseFloat(data.price) : null,
                  status: "negotiating"
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
                  status: "negotiating",
                  proposed_amount: data.price ? parseFloat(data.price) : null
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

          // Calculate payment breakdown for transparency
          const priceBreakdown = await this.calculatePaymentBreakdown(data.price);
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💰 **Price Offer: ₹${data.price}**\n\n` +
              `📊 **Payment Breakdown:**\n` +
              `• Total Amount: ${priceBreakdown.display.total}\n` +
              `• Platform Fee: ${priceBreakdown.display.commission}\n` +
              `• You'll Receive: ${priceBreakdown.display.net_to_influencer}\n\n` +
              `💳 **Payment Schedule:**\n` +
              `• Advance (30%): ${priceBreakdown.display.advance}\n` +
              `• Final (70%): ${priceBreakdown.display.final}\n\n` +
              `Please review and respond.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Price Offer Response**",
              subtitle: "Choose how you'd like to respond to this price offer:",
              buttons: [
                {
                  id: "accept_price",
                  text: "Accept Offer",
                  style: "success",
                  action: "accept_price",
                },
                {
                  id: "reject_price",
                  text: "Reject Offer",
                  style: "danger",
                  action: "reject_price",
                },
                {
                  id: "negotiate_price",
                  text: "Negotiate Price",
                  style: "warning",
                  action: "negotiate_price",
                },
              ],
              // Add payment breakdown
              payment_breakdown: {
                total_amount: priceBreakdown.total_amount_paise,
                commission_amount: priceBreakdown.commission_amount_paise,
                commission_percentage: priceBreakdown.commission_percentage,
                net_amount: priceBreakdown.net_amount_paise,
                advance_amount: priceBreakdown.advance_amount_paise,
                final_amount: priceBreakdown.final_amount_paise,
                display: priceBreakdown.display
              },
              flow_state: "influencer_price_response",
              message_type: "influencer_price_response",
              visible_to: "influencer",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Price Offer Sent**\n\nYou have offered ₹${data.price} to the influencer.\n\n📊 **Payment Breakdown:**\n• **Total Amount:** ₹${priceBreakdown.total_amount_paise / 100}\n• **Platform Commission (${priceBreakdown.commission_percentage}%):** ₹${priceBreakdown.commission_amount_paise / 100}\n• **Influencer Net Amount:** ₹${priceBreakdown.net_amount_paise / 100}\n\n💳 **Payment Schedule:**\n• **Advance Payment:** ₹${priceBreakdown.advance_amount_paise / 100} (30%)\n• **Final Payment:** ₹${priceBreakdown.final_amount_paise / 100} (70%)`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "handle_negotiation":
          // Brand owner handles negotiation
          // More robust comparison
          const actionValue = data.action?.toString()?.trim()?.toLowerCase();
          if (actionValue === "agree") {
            newFlowState = "influencer_price_input";
            newAwaitingRole = "influencer";
            
            // Fallback: if database doesn't support influencer_price_input yet, use influencer_price_response

            newMessage = {
              conversation_id: conversationId,
              sender_id: conversation.brand_owner_id,
              receiver_id: conversation.influencer_id,
              message: `🤝 **Negotiation Accepted**\n\nBrand owner has agreed to negotiate. Please set your counter offer.`,
              message_type: "automated",
              action_required: true,
              action_data: {
                title: "💰 **Set Your Counter Offer**",
                subtitle: `What's your counter offer for this project?`,
                input_field: {
                  id: "counter_price",
                  type: "number",
                  placeholder: "Enter your counter offer amount",
                  required: true,
                  min: 1,
                },
                buttons: [
                  {
                    id: "send_counter_offer",
                    text: "Send Counter Offer",
                    style: "success",
                    action: "send_counter_offer",
                  },
                ],
                flow_state: "influencer_price_input", // Will be updated to influencer_price_response if fallback occurs
                message_type: "influencer_counter_offer",
                visible_to: "influencer",
              },
            };

            auditMessage = {
              conversation_id: conversationId,
              sender_id: SYSTEM_USER_ID,
              receiver_id: conversation.brand_owner_id,
              message: `✅ **Action Taken: Negotiation Accepted**\n\nYou have agreed to negotiate. Please wait for the influencer's counter offer.`,
              message_type: "audit",
              action_required: false,
            };
          } else {
            // Reject negotiation
            newFlowState = "chat_closed";
            newAwaitingRole = null;

            newMessage = {
              conversation_id: conversationId,
              sender_id: conversation.brand_owner_id,
              receiver_id: conversation.influencer_id,
              message: `❌ **Negotiation Rejected**\n\nBrand owner has rejected the negotiation request. The chat is now closed.`,
              message_type: "automated",
              action_required: false,
            };

            auditMessage = {
              conversation_id: conversationId,
              sender_id: SYSTEM_USER_ID,
              receiver_id: conversation.brand_owner_id,
              message: `✅ **Action Taken: Negotiation Rejected**\n\nYou have rejected the negotiation request.`,
              message_type: "audit",
              action_required: false,
            };
          }
          break;

        case "send_negotiated_price":
          // Brand owner sends negotiated price
          newFlowState = "influencer_final_response";
          newAwaitingRole = "influencer";

          // Persist the negotiated price as requests.proposed_amount
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({
                proposed_amount: data.price ? parseFloat(data.price) : null,
                status: "negotiating"
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
                  proposed_amount: data.price ? parseFloat(data.price) : null,
                  status: "negotiating"
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
                  status: "negotiating",
                  proposed_amount: data.price ? parseFloat(data.price) : null
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

          // Calculate payment breakdown for transparency
          const negotiatedBreakdown = await this.calculatePaymentBreakdown(data.price);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💰 **Negotiated Price Offer: ₹${data.price}**\n\n` +
              `📊 **Payment Breakdown:**\n` +
              `• Total Amount: ${negotiatedBreakdown.display.total}\n` +
              `• Platform Fee: ${negotiatedBreakdown.display.commission}\n` +
              `• You'll Receive: ${negotiatedBreakdown.display.net_to_influencer}\n\n` +
              `💳 **Payment Schedule:**\n` +
              `• Advance (30%): ${negotiatedBreakdown.display.advance}\n` +
              `• Final (70%): ${negotiatedBreakdown.display.final}\n\n` +
              `Please review and respond.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Final Price Response**",
              subtitle: "Choose how you'd like to respond to this offer:",
              buttons: [
                {
                  id: "accept_negotiated_price",
                  text: "Accept Offer",
                  style: "success",
                  action: "accept_negotiated_price",
                },
                {
                  id: "reject_negotiated_price",
                  text: "Reject Offer",
                  style: "danger",
                  action: "reject_negotiated_price",
                },
                {
                  id: "continue_negotiate",
                  text: "Continue Negotiating",
                  style: "warning",
                  action: "continue_negotiate",
                },
              ],
              // Add payment breakdown
              payment_breakdown: {
                total_amount: priceBreakdown.total_amount_paise,
                commission_amount: priceBreakdown.commission_amount_paise,
                commission_percentage: priceBreakdown.commission_percentage,
                net_amount: priceBreakdown.net_amount_paise,
                advance_amount: priceBreakdown.advance_amount_paise,
                final_amount: priceBreakdown.final_amount_paise,
                display: priceBreakdown.display
              },
              flow_state: "influencer_final_response",
              message_type: "influencer_final_price_response",
              visible_to: "influencer",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Negotiated Price Sent**\n\nYou have sent a new price offer: ₹${data.price}`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "proceed_to_payment":
          // Brand owner proceeds to payment
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          // Get the amount from various sources
          let paymentAmount = data.amount || 0;
          
          if (paymentAmount <= 0) {
            
            // First try to get amount from linked request
            if (conversation.request_id) {
              const { data: request } = await supabaseAdmin
                .from("requests")
                .select("proposed_amount, final_agreed_amount")
                .eq("id", conversation.request_id)
                .single();
              // Check final_agreed_amount first, then fall back to proposed_amount
              if (request?.final_agreed_amount && parseFloat(request.final_agreed_amount) > 0) {
                paymentAmount = parseFloat(request.final_agreed_amount);
              } else if (request?.proposed_amount && parseFloat(request.proposed_amount) > 0) {
                paymentAmount = parseFloat(request.proposed_amount);
              }
            }
            // If no linked request, attempt to find one by bid_id + influencer_id or campaign_id + influencer_id
            if (paymentAmount <= 0 && conversation.influencer_id) {
              let requestQuery = supabaseAdmin
                .from("requests")
                .select("id, proposed_amount, final_agreed_amount, bid_id, campaign_id")
                .eq("influencer_id", conversation.influencer_id)
                .order("updated_at", { ascending: false })
                .limit(1);
              
              if (conversation.bid_id) {
                requestQuery = requestQuery.eq("bid_id", conversation.bid_id);
              } else if (conversation.campaign_id) {
                requestQuery = requestQuery.eq("campaign_id", conversation.campaign_id);
              }
              
              const { data: reqByPair } = await requestQuery.single();
              if (reqByPair) {
                // Check final_agreed_amount first, then fall back to proposed_amount
                if (reqByPair.final_agreed_amount && parseFloat(reqByPair.final_agreed_amount) > 0) {
                  paymentAmount = parseFloat(reqByPair.final_agreed_amount);
                } else if (reqByPair.proposed_amount && parseFloat(reqByPair.proposed_amount) > 0) {
                  paymentAmount = parseFloat(reqByPair.proposed_amount);
                }
                // Also backfill conversation.request_id for future
                if (reqByPair.id) {
                  await supabaseAdmin
                    .from("conversations")
                    .update({ request_id: reqByPair.id })
                    .eq("id", conversationId);
                }
              }
            }
            // Fall back to conversation flow_data agreed_amount
            if (paymentAmount <= 0 && conversation.flow_data && conversation.flow_data.agreed_amount) {
              paymentAmount = conversation.flow_data.agreed_amount;
            }
            // Try to get amount from recent price negotiation messages
            if (paymentAmount <= 0) {
              const { data: priceMessages } = await supabaseAdmin
                .from("messages")
                .select("message, action_data")
                .eq("conversation_id", conversationId)
                .in("message_type", ["influencer_price_response", "brand_owner_pricing_input", "brand_owner_negotiation_response"])
                .order("created_at", { ascending: false })
                .limit(5);
              
              // Look for price in recent messages
              for (const msg of priceMessages || []) {
                const priceMatch = msg.message?.match(/₹(\d+(?:\.\d{2})?)/);
                if (priceMatch) {
                  paymentAmount = parseFloat(priceMatch[1]);
                  break;
                }
                // Also check action_data for price
                if (msg.action_data && msg.action_data.price) {
                  paymentAmount = parseFloat(msg.action_data.price);
                  break;
                }
              }
            }
            
            // Final fallback: check conversation flow_data for agreed amount
            if (paymentAmount <= 0 && conversation.flow_data?.agreed_amount) {
              paymentAmount = parseFloat(conversation.flow_data.agreed_amount);
            }
          }
          
          if (paymentAmount <= 0) {
            throw new Error('Payment amount is required. Ensure requests.proposed_amount/final_agreed_amount is set, or pass data.amount');
          }
          // Convert to paise for database storage
          const paymentAmountPaise = Math.round(paymentAmount * 100);

          // Calculate payment breakdown for transparency
          const paymentBreakdown = await this.calculatePaymentBreakdown(paymentAmount);

          // Create Razorpay order
          const Razorpay = require('razorpay');
          const keyId = process.env.RAZORPAY_KEY_ID;
          const keySecret = process.env.RAZORPAY_KEY_SECRET;
          if (!keyId || !keySecret) {
            throw new Error("Payment gateway configuration missing. Please set Razorpay keys.");
          }
          const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

          let razorpayOrder;
          try {
            const shortReceipt = `ord_${String(conversationId).slice(0,8)}_${Math.floor(Date.now()/1000)}`;
            razorpayOrder = await razorpay.orders.create({
              amount: paymentAmountPaise,
              currency: 'INR',
              receipt: shortReceipt,
              notes: {
                conversation_id: conversationId,
                conversation_type: conversation.campaign_id ? "campaign" : "bid",
                brand_owner_id: conversation.brand_owner_id,
                influencer_id: conversation.influencer_id,
                payment_type: 'bid_campaign_collaboration'
              }
            });
          } catch (rpErr) {
            throw new Error(`Payment order creation failed at gateway: ${rpErr?.message || rpErr}`);
          }

          // Track brand owner payment (debit) before creating payment order
          const enhancedBalanceService = require('./enhancedBalanceService');
          const brandOwnerDebitResult = await enhancedBalanceService.trackBrandOwnerPayment(
            conversation.brand_owner_id,
            paymentAmountPaise,
            conversationId,
            {
              razorpay_order_id: razorpayOrder.id,
              conversation_type: conversation.campaign_id ? "campaign" : "bid",
              influencer_id: conversation.influencer_id,
              notes: `Payment initiated for ${conversation.campaign_id ? 'campaign' : 'bid'} collaboration`
            }
          );

          if (!brandOwnerDebitResult.success) {
            // Continue anyway as payment order creation is more critical
          } else {
          }

          // Create payment order in database
          const { data: paymentOrder, error: orderError } = await supabaseAdmin
            .from("payment_orders")
            .insert({
              conversation_id: conversationId,
              amount_paise: paymentAmountPaise,
              currency: "INR",
              status: "created",
              razorpay_order_id: razorpayOrder.id,
              metadata: {
                conversation_type: conversation.campaign_id ? "campaign" : "bid",
                brand_owner_id: conversation.brand_owner_id,
                influencer_id: conversation.influencer_id,
                razorpay_receipt: razorpayOrder.receipt,
                brand_owner_debit_transaction_id: brandOwnerDebitResult.success ? brandOwnerDebitResult.transaction.id : null
              }
            })
            .select()
            .single();

          if (orderError) {
            throw new Error(`Failed to create payment order: ${orderError.message}`);
          }

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💳 **Payment Required: ₹${paymentAmount}**\n\n` +
              `📊 **Payment Breakdown:**\n` +
              `• Total Amount: ${paymentBreakdown.display.total}\n` +
              `• Platform Fee: ${paymentBreakdown.display.commission}\n` +
              `• Influencer Net: ${paymentBreakdown.display.net_to_influencer}\n\n` +
              `💳 **Payment Schedule:**\n` +
              `• Advance (30%): ${paymentBreakdown.display.advance}\n` +
              `• Final (70%): ${paymentBreakdown.display.final}\n\n` +
              `Please complete the payment to proceed with the collaboration.`,
            message_type: "brand_owner_payment",
            action_required: true,
            action_data: {
              title: "🎯 **Payment Required**",
              subtitle: "Complete the payment to finalize the collaboration:",
              flow_state: "payment_pending",
              visible_to: "brand_owner",
              message_type: "brand_owner_payment",
              payment_order: {
                razorpay_config: {
                  order_id: razorpayOrder.id,
                  amount: paymentAmountPaise,
                  currency: "INR",
                  key_id: process.env.RAZORPAY_KEY_ID,
                  name: "Stoory Platform",
                  description: "Payment for Campaign Collaboration",
                  prefill: {
                    name: "Brand Owner",
                    email: "brand@example.com",
                    contact: "9876543210"
                  },
                  theme: {
                    color: "#3B82F6"
                  }
                }
              },
              buttons: [
                {
                  id: "pay_now",
                  text: "Pay Now",
                  action: "proceed_to_payment",
                  style: "primary"
                }
              ],
              // Add payment breakdown
              payment_breakdown: {
                total_amount: paymentBreakdown.total_amount_paise,
                commission_amount: paymentBreakdown.commission_amount_paise,
                commission_percentage: paymentBreakdown.commission_percentage,
                net_amount: paymentBreakdown.net_amount_paise,
                advance_amount: paymentBreakdown.advance_amount_paise,
                final_amount: paymentBreakdown.final_amount_paise,
                display: paymentBreakdown.display
              }
            }
          };
          break;

        case "accept_counter_offer":
          // Brand owner accepts counter offer
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          // Update the final agreed amount in requests table
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({
                final_agreed_amount: data.price ? parseFloat(data.price) : null,
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
                  final_agreed_amount: data.price ? parseFloat(data.price) : null,
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
                  proposed_amount: data.price ? parseFloat(data.price) : null,
                  final_agreed_amount: data.price ? parseFloat(data.price) : null
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
            message: `✅ **Counter Offer Accepted**\n\nBrand owner has accepted your counter offer of ₹${data.price}. Please proceed with payment to complete the collaboration.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Payment Required**",
              subtitle: `Accepted amount: ₹${data.price}`,
              buttons: [
                {
                  id: "proceed_to_payment",
                  text: "Proceed to Payment",
                  style: "success",
                  action: "proceed_to_payment",
                  data: { amount: data.price },
                },
              ],
              flow_state: "payment_pending",
              message_type: "brand_owner_payment",
              visible_to: "brand_owner",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Counter Offer Accepted**\n\nYou have accepted the counter offer of ₹${data.price}.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "reject_counter_offer":
          // Brand owner rejects counter offer - loop back to influencer for new counter offer
          currentRound = (typeof conversation.negotiation_round === 'number' && !Number.isNaN(conversation.negotiation_round))
            ? conversation.negotiation_round
            : (baseNegotiationHistory.length || 0);
          const maxRounds = conversation.max_negotiation_rounds || 3;
          
          // No max rounds logic: always loop back for another counter if rejected
          {
            // Still within limits, loop back to influencer for new counter offer
            newFlowState = "influencer_price_input";
            newAwaitingRole = "influencer";

            // Update negotiation history
            // Use the variables already declared at the beginning of the method
            const newHistoryEntry = {
              round: currentRound,
              brand_owner_action: "rejected",
              rejected_price: parseFloat(data.price),
              timestamp: new Date().toISOString(),
              action: "counter_offer_rejected"
            };
            const updatedHistory = [...baseNegotiationHistory, newHistoryEntry];

            newMessage = {
              conversation_id: conversationId,
              sender_id: conversation.brand_owner_id,
              receiver_id: conversation.influencer_id,
              message: `❌ **Counter Offer Rejected**\n\nBrand owner has rejected your counter offer of ₹${data.price}. You can make another counter offer.`,
              message_type: "automated",
              action_required: true,
              action_data: {
                title: "💰 **Make Another Counter Offer**",
                subtitle: `Your previous offer was rejected. What's your new counter offer?`,
                input_field: {
                  id: "counter_price",
                  type: "number",
                  placeholder: "Enter your new counter offer amount",
                  required: true,
                  min: 1,
                },
                buttons: [
                  {
                    id: "send_counter_offer",
                    text: "Send Counter Offer",
                    style: "success",
                    action: "send_counter_offer",
                  },
                ],
                flow_state: "influencer_price_input",
                message_type: "influencer_counter_offer",
                visible_to: "influencer",
              },
            };

            auditMessage = {
              conversation_id: conversationId,
              sender_id: SYSTEM_USER_ID,
              receiver_id: conversation.brand_owner_id,
              message: `✅ **Action Taken: Counter Offer Rejected**\n\nYou have rejected the counter offer. The influencer can make another offer.`,
              message_type: "audit",
              action_required: false,
            };

            // Update conversation with negotiation history
            await supabaseAdmin
              .from("conversations")
              .update({
                negotiation_history: updatedHistory
              })
              .eq("id", conversationId);
          }
          break;

        case "make_final_offer":
          // Brand owner makes final offer
          newFlowState = "influencer_final_response";
          newAwaitingRole = "influencer";

          // Calculate payment breakdown for transparency
          const finalOfferBreakdown = await this.calculatePaymentBreakdown(data.price);

          // Persist the final offer price as requests.proposed_amount
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({
                proposed_amount: data.price ? parseFloat(data.price) : null,
                status: "negotiating"
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
                  proposed_amount: data.price ? parseFloat(data.price) : null,
                  status: "negotiating"
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
                  status: "negotiating",
                  proposed_amount: data.price ? parseFloat(data.price) : null
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
            message: `💰 **Final Offer: ₹${data.price}**\n\n` +
              `📊 **Payment Breakdown:**\n` +
              `• Total Amount: ${finalOfferBreakdown.display.total}\n` +
              `• Platform Fee: ${finalOfferBreakdown.display.commission}\n` +
              `• You'll Receive: ${finalOfferBreakdown.display.net_to_influencer}\n\n` +
              `💳 **Payment Schedule:**\n` +
              `• Advance (30%): ${finalOfferBreakdown.display.advance}\n` +
              `• Final (70%): ${finalOfferBreakdown.display.final}\n\n` +
              `This is the final offer. Please respond.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Final Offer Response**",
              subtitle: `Brand owner's final offer: ₹${data.price}`,
              buttons: [
                {
                  id: "accept_final_offer",
                  text: "Accept Final Offer",
                  style: "success",
                  action: "accept_final_offer",
                  data: { price: data.price },
                },
                {
                  id: "reject_final_offer",
                  text: "Reject Final Offer",
                  style: "danger",
                  action: "reject_final_offer",
                },
              ],
              // Add payment breakdown
              payment_breakdown: {
                total_amount: finalOfferBreakdown.total_amount_paise,
                commission_amount: finalOfferBreakdown.commission_amount_paise,
                commission_percentage: finalOfferBreakdown.commission_percentage,
                net_amount: finalOfferBreakdown.net_amount_paise,
                advance_amount: finalOfferBreakdown.advance_amount_paise,
                final_amount: finalOfferBreakdown.final_amount_paise,
                display: finalOfferBreakdown.display
              },
              flow_state: "influencer_final_response",
              message_type: "influencer_final_response",
              visible_to: "influencer",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Final Offer Made**\n\nYou have made a final offer of ₹${data.price}.\n\n📊 **Payment Breakdown:**\n• **Total Amount:** ₹${finalOfferBreakdown.total_amount_paise / 100}\n• **Platform Commission (${finalOfferBreakdown.commission_percentage}%):** ₹${finalOfferBreakdown.commission_amount_paise / 100}\n• **Influencer Net Amount:** ₹${finalOfferBreakdown.net_amount_paise / 100}\n\n💳 **Payment Schedule:**\n• **Advance Payment:** ₹${finalOfferBreakdown.advance_amount_paise / 100} (30%)\n• **Final Payment:** ₹${finalOfferBreakdown.final_amount_paise / 100} (70%)`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "approve_work":
          // Brand owner approves work
          newFlowState = "admin_final_payment_pending";
          newAwaitingRole = "admin"; // Admin needs to release final payment
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `✅ **Work Approved!**\n\nExcellent work! The collaboration has been completed successfully.${data.feedback ? `\n\n**Feedback:** ${data.feedback}` : ''}\n\nThe final payment will be processed by our admin team.`,
            message_type: "automated",
            action_required: false,
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Work Approved**\n\nYou have approved the submitted work. The final payment will be processed by admin.`,
            message_type: "audit",
            action_required: false,
          };

          // Update conversation with approval status
          await supabaseAdmin
            .from("conversations")
            .update({
              flow_state: newFlowState,
              awaiting_role: newAwaitingRole,
              chat_status: "automated", // Set to automated to show waiting status
              flow_data: {
                ...conversation.flow_data,
                work_status: "approved",
                approval_date: new Date().toISOString(),
                approval_feedback: data.feedback || null
              }
            })
            .eq("id", conversationId);
          break;

        case "request_revision":
          // Brand owner requests revision
          const currentRevisionCount = conversation.flow_data?.revision_count || 0;
          const maxRevisions = conversation.flow_data?.max_revisions || 3;
          const newRevisionCount = currentRevisionCount + 1;
          
          newFlowState = "work_in_progress";
          newAwaitingRole = "influencer";
          
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `🔄 **Revision Requested**\n\nPlease make the following changes to your work:\n\n${data.feedback || data.revision_notes || 'Please review and improve the submitted work.'}\n\n**Revision:** ${newRevisionCount}/${maxRevisions}\n\nPlease resubmit your work after making the requested changes.`,
            message_type: "automated",
            action_required: false,
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Revision Requested**\n\nYou have requested revision ${newRevisionCount}/${maxRevisions} of the submitted work.`,
            message_type: "audit",
            action_required: false,
          };

          // Update conversation with revision request and change chat_status back to real_time
          await supabaseAdmin
            .from("conversations")
            .update({
              flow_data: {
                ...conversation.flow_data,
                work_status: "revision_requested",
                revision_count: newRevisionCount,
                revision_feedback: data.feedback || data.revision_notes || null
              },
              chat_status: "real_time" // Back to free chat for revision discussion
            })
            .eq("id", conversationId);
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

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Work Rejected (Final)**\n\nYou have rejected the work after ${conversation.flow_data?.revision_count || 0} revision(s).`,
            message_type: "audit",
            action_required: false,
          };

          // Update conversation with rejection status
          await supabaseAdmin
            .from("conversations")
            .update({
              flow_data: {
                ...conversation.flow_data,
                work_status: "rejected",
                rejection_date: new Date().toISOString(),
                rejection_reason: data.feedback || data.rejection_reason || null
              },
              chat_status: "closed"
            })
            .eq("id", conversationId);
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Update conversation state
      const updateData = {
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
      };

      // For proceed_to_payment, also update current_action_data with payment order
      if (action === "proceed_to_payment" && newMessage.action_data) {
        updateData.current_action_data = newMessage.action_data;
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

      // Create messages
      const messagesToCreate = [newMessage];
      // No audit messages should be created

      const { data: createdMessages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messagesToCreate)
        .select();

      if (messageError) {
        throw new Error(`Failed to create messages: ${messageError.message}`);
      }

      // Set current_action_data based on the action and flow state
      let currentActionData = {};
      
      if (action === "proceed_to_payment") {
        currentActionData = newMessage.action_data || {};
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
        audit_message: auditMessage ? createdMessages[1] : null,
      };

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
          this.io.to(`conversation_${conversationId}`).emit('conversation_state_changed', {
            conversation_id: conversationId,
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: 'automated',
            current_action_data: result.conversation.current_action_data,
            updated_at: new Date().toISOString()
          });

          // Emit new message to conversation room
          if (result.message) {
            this.io.to(`conversation_${conversationId}`).emit('new_message', {
              conversation_id: conversationId,
              message: result.message,
              conversation_context: {
                id: conversationId,
                chat_status: 'automated',
                flow_state: newFlowState,
                awaiting_role: newAwaitingRole,
                conversation_type: conversation.campaign_id ? 'campaign' : conversation.bid_id ? 'bid' : 'direct',
                automation_enabled: true,
                current_action_data: result.conversation.current_action_data
              }
            });
          }

          // Emit audit message if exists
          if (result.audit_message) {
            this.io.to(`conversation_${conversationId}`).emit('new_message', {
              conversation_id: conversationId,
              message: result.audit_message,
              conversation_context: {
                id: conversationId,
                chat_status: 'automated',
                flow_state: newFlowState,
                awaiting_role: newAwaitingRole,
                conversation_type: conversation.campaign_id ? 'campaign' : conversation.bid_id ? 'bid' : 'direct',
                automation_enabled: true,
                current_action_data: result.conversation.current_action_data
              }
            });
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

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Connection Accepted**\n\nYou have accepted the connection request from the brand owner.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "reject":
        case "reject_connection":
          // Influencer rejects connection
          newFlowState = "chat_closed";
          newAwaitingRole = null;

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `❌ **Connection Rejected**\n\nInfluencer has rejected your connection request. The chat is now closed.`,
            message_type: "automated",
            action_required: false,
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Connection Rejected**\n\nYou have rejected the connection request from the brand owner.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "accept_project":
          // Influencer accepts project requirements
          newFlowState = "brand_owner_pricing";
          newAwaitingRole = "brand_owner";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Project Requirements Accepted**\n\nInfluencer has accepted the project requirements. Please provide your price offer.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Price Offer Input**",
              subtitle: "Enter the offering price for this project:",
              input_field: {
                id: "price_offer",
                type: "number",
                placeholder: "Enter price amount in INR",
                required: true,
                min: 1,
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

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Project Requirements Accepted**\n\nYou have accepted the project requirements from the brand owner.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "deny_project":
          // Influencer denies project requirements
          newFlowState = "chat_closed";
          newAwaitingRole = null;

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `❌ **Project Requirements Denied**\n\nInfluencer has denied the project requirements. The chat is now closed.`,
            message_type: "automated",
            action_required: false,
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Project Requirements Denied**\n\nYou have denied the project requirements from the brand owner.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "accept_price":
          // Influencer accepts price offer
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          // Determine agreed price: prefer requests.proposed_amount if present
          let finalAgreedPrice = parseFloat(data.price) || 0;
          if (!finalAgreedPrice && conversation.request_id) {
            const { data: reqForAccept } = await supabaseAdmin
              .from("requests")
              .select("proposed_amount")
              .eq("id", conversation.request_id)
              .single();
            if (reqForAccept?.proposed_amount) {
              finalAgreedPrice = parseFloat(reqForAccept.proposed_amount);
            }
          }

          // Store the agreed price in flow_data for later retrieval
          const updatedFlowData = {
            ...conversation.flow_data,
            agreed_amount: finalAgreedPrice,
            agreement_timestamp: new Date().toISOString(),
            negotiation_completed: true
          };

          // If a request exists, move proposed_amount to final_agreed_amount when accepted
          if (conversation.request_id) {
            // Read proposed_amount first
            const { data: reqRow } = await supabaseAdmin
              .from("requests")
              .select("proposed_amount")
              .eq("id", conversation.request_id)
              .single();
            const finalAmount = (reqRow?.proposed_amount && parseFloat(reqRow.proposed_amount) > 0)
              ? parseFloat(reqRow.proposed_amount)
              : finalAgreedPrice;
            await supabaseAdmin
              .from("requests")
              .update({
                final_agreed_amount: finalAmount,
                status: "finalized"
              })
              .eq("id", conversation.request_id);
          }

          // Calculate payment breakdown for transparency
          const acceptBreakdown = await this.calculatePaymentBreakdown(finalAgreedPrice);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Price Offer Accepted: ₹${finalAgreedPrice}**\n\n` +
              `📊 **Payment Breakdown:**\n` +
              `• Total Amount: ${acceptBreakdown.display.total}\n` +
              `• Platform Fee: ${acceptBreakdown.display.commission}\n` +
              `• Net Amount: ${acceptBreakdown.display.net_to_influencer}\n\n` +
              `💳 **Payment Schedule:**\n` +
              `• Advance (30%): ${acceptBreakdown.display.advance}\n` +
              `• Final (70%): ${acceptBreakdown.display.final}\n\n` +
              `Please proceed with payment to complete the collaboration.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Payment Required**",
              subtitle: "Complete the payment to finalize the collaboration:",
              buttons: [
                {
                  id: "proceed_to_payment",
                  text: "Proceed to Payment",
                  style: "success",
                  action: "proceed_to_payment",
                },
              ],
              flow_state: "payment_pending",
              message_type: "brand_owner_payment",
              visible_to: "brand_owner",
            },
          };

          // Update conversation with agreed price
          const { error: flowDataError } = await supabaseAdmin
            .from("conversations")
            .update({ flow_data: updatedFlowData })
            .eq("id", conversationId);

          if (flowDataError) {
            console.error("❌ [DEBUG] Failed to update flow_data:", flowDataError);
          } else {
            console.log("✅ [DEBUG] Updated flow_data with agreed price:", agreedPrice);
          }

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Price Offer Accepted**\n\nYou have accepted the price offer from the brand owner.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "reject_price":
          // Influencer rejects price offer
          newFlowState = "chat_closed";
          newAwaitingRole = null;

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `❌ **Price Offer Rejected**\n\nInfluencer has rejected your price offer. The chat is now closed.`,
            message_type: "automated",
            action_required: false,
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Price Offer Rejected**\n\nYou have rejected the price offer from the brand owner.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "negotiate_price":
          // Influencer wants to negotiate
          newFlowState = "brand_owner_negotiation";
          newAwaitingRole = "brand_owner";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `🤝 **Negotiation Request**\n\nInfluencer wants to negotiate the price offer. Please respond to this request.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Negotiation Response**",
              subtitle:
                "Choose how you'd like to respond to the negotiation request:",
              buttons: [
                {
                  id: "agree_negotiation",
                  text: "Agree to Negotiate",
                  style: "success",
                  action: "handle_negotiation",
                  data: { action: "agree" },
                },
                {
                  id: "reject_negotiation",
                  text: "Reject Negotiation",
                  style: "danger",
                  action: "handle_negotiation",
                  data: { action: "reject" },
                },
              ],
              flow_state: "brand_owner_negotiation",
              message_type: "brand_owner_negotiation_response",
              visible_to: "brand_owner",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Negotiation Requested**\n\nYou have requested to negotiate the price offer.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "send_counter_offer":
          // Influencer sends counter offer
          
          if (!data.price || data.price === undefined) {
            console.error("❌ [ERROR] send_counter_offer called without price data!");
            return {
              success: false,
              error: "Price is required for counter offer",
            };
          }

          // Calculate payment breakdown for transparency
          const counterOfferBreakdown = await this.calculatePaymentBreakdown(data.price);
          
          newFlowState = "brand_owner_price_response";
          newAwaitingRole = "brand_owner";

          // No negotiation rounds tracking

          // Update negotiation history
          // Use the variables already declared at the beginning of the method
          const newHistoryEntry = {
            round: currentRound,
            influencer_price: parseFloat(data.price),
            timestamp: new Date().toISOString(),
            action: "counter_offer"
          };
          const updatedHistory = [...baseNegotiationHistory, newHistoryEntry];

          // Persist negotiation round increment and history
          try {
            await supabaseAdmin
              .from("conversations")
              .update({
                negotiation_round: currentRound + 1,
                negotiation_history: updatedHistory
              })
              .eq("id", conversationId);
          } catch (e) {
            console.error("❌ [NEGOTIATION] Failed to persist negotiation round/history:", e);
          }

          // Persist the counter offer price as requests.proposed_amount
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({
                proposed_amount: data.price ? parseFloat(data.price) : null,
                status: "negotiating"
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
                  proposed_amount: data.price ? parseFloat(data.price) : null,
                  status: "negotiating"
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
                  status: "negotiating",
                  proposed_amount: data.price ? parseFloat(data.price) : null
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
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `💰 **Counter Offer: ₹${data.price}**\n\n` +
              `📊 **Payment Breakdown:**\n` +
              `• Total Amount: ${counterOfferBreakdown.display.total}\n` +
              `• Platform Fee: ${counterOfferBreakdown.display.commission}\n` +
              `• Influencer Net: ${counterOfferBreakdown.display.net_to_influencer}\n\n` +
              `💳 **Payment Schedule:**\n` +
              `• Advance (30%): ${counterOfferBreakdown.display.advance}\n` +
              `• Final (70%): ${counterOfferBreakdown.display.final}\n\n` +
              `Please respond to this offer.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Counter Offer Response**",
              subtitle: `Influencer's counter offer: ₹${data.price}`,
              buttons: [
                {
                  id: "accept_counter_offer",
                  text: "Accept Counter Offer",
                  style: "success",
                  action: "accept_counter_offer",
                  data: { price: data.price },
                },
                {
                  id: "reject_counter_offer",
                  text: "Reject Counter Offer",
                  style: "danger",
                  action: "reject_counter_offer",
                  data: { price: data.price },
                },
                {
                  id: "make_final_offer",
                  text: "Make Final Offer",
                  style: "secondary",
                  action: "make_final_offer",
                },
              ],
              // Add payment breakdown
              payment_breakdown: {
                total_amount: counterOfferBreakdown.total_amount_paise,
                commission_amount: counterOfferBreakdown.commission_amount_paise,
                commission_percentage: counterOfferBreakdown.commission_percentage,
                net_amount: counterOfferBreakdown.net_amount_paise,
                advance_amount: counterOfferBreakdown.advance_amount_paise,
                final_amount: counterOfferBreakdown.final_amount_paise,
                display: counterOfferBreakdown.display
              },
              flow_state: "brand_owner_price_response",
              message_type: "brand_owner_counter_response",
              visible_to: "brand_owner",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Counter Offer Sent**\n\nYou have sent a counter offer of ₹${data.price}.\n\n📊 **Payment Breakdown:**\n• **Total Amount:** ₹${counterOfferBreakdown.total_amount_paise / 100}\n• **Platform Commission (${counterOfferBreakdown.commission_percentage}%):** ₹${counterOfferBreakdown.commission_amount_paise / 100}\n• **Your Net Amount:** ₹${counterOfferBreakdown.net_amount_paise / 100}\n\n💳 **Payment Schedule:**\n• **Advance Payment:** ₹${counterOfferBreakdown.advance_amount_paise / 100} (30%)\n• **Final Payment:** ₹${counterOfferBreakdown.final_amount_paise / 100} (70%)`,
            message_type: "audit",
            action_required: false,
          };

          // Update conversation with negotiation history only
          await supabaseAdmin
            .from("conversations")
            .update({
              negotiation_history: updatedHistory
            })
            .eq("id", conversationId);
          break;

        case "accept_final_offer":
          // Influencer accepts final offer
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          // Calculate payment breakdown for transparency
          const finalPrice = data.price ? parseFloat(data.price) : 0;
          const finalOfferBreakdown = await this.calculatePaymentBreakdown(finalPrice);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Final Offer Accepted: ₹${finalPrice}**\n\n` +
              `📊 **Payment Breakdown:**\n` +
              `• Total Amount: ${finalOfferBreakdown.display.total}\n` +
              `• Platform Fee: ${finalOfferBreakdown.display.commission}\n` +
              `• Net Amount: ${finalOfferBreakdown.display.net_to_influencer}\n\n` +
              `💳 **Payment Schedule:**\n` +
              `• Advance (30%): ${finalOfferBreakdown.display.advance}\n` +
              `• Final (70%): ${finalOfferBreakdown.display.final}\n\n` +
              `Please proceed with payment to complete the collaboration.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Payment Required**",
              subtitle: `Accepted amount: ₹${data.price}`,
              buttons: [
                {
                  id: "proceed_to_payment",
                  text: "Proceed to Payment",
                  style: "success",
                  action: "proceed_to_payment",
                  data: { amount: data.price },
                },
              ],
              flow_state: "payment_pending",
              message_type: "brand_owner_payment",
              visible_to: "brand_owner",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Final Offer Accepted**\n\nYou have accepted the final offer of ₹${data.price}.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "reject_final_offer":
          // Influencer rejects final offer
          newFlowState = "chat_closed";
          newAwaitingRole = null;

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `❌ **Final Offer Rejected**\n\nInfluencer has rejected your final offer. The collaboration has been cancelled.`,
            message_type: "automated",
            action_required: false,
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Final Offer Rejected**\n\nYou have rejected the final offer.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "accept_negotiated_price":
        case "accept_final_price":
          // Influencer accepts negotiated price
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          // Update the final agreed amount in requests table
          if (conversation.request_id) {
            await supabaseAdmin
              .from("requests")
              .update({
                final_agreed_amount: data.price ? parseFloat(data.price) : null,
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
                  final_agreed_amount: data.price ? parseFloat(data.price) : null,
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
                  proposed_amount: data.price ? parseFloat(data.price) : null,
                  final_agreed_amount: data.price ? parseFloat(data.price) : null
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

          // Calculate payment breakdown for transparency
          const negotiatedPrice = data.price ? parseFloat(data.price) : 0;
          const negotiatedPaymentBreakdown = await this.calculatePaymentBreakdown(negotiatedPrice);

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Negotiated Price Accepted: ₹${negotiatedPrice}**\n\n` +
              `📊 **Payment Breakdown:**\n` +
              `• Total Amount: ${negotiatedPaymentBreakdown.display.total}\n` +
              `• Platform Fee: ${negotiatedPaymentBreakdown.display.commission}\n` +
              `• Net Amount: ${negotiatedPaymentBreakdown.display.net_to_influencer}\n\n` +
              `💳 **Payment Schedule:**\n` +
              `• Advance (30%): ${negotiatedPaymentBreakdown.display.advance}\n` +
              `• Final (70%): ${negotiatedPaymentBreakdown.display.final}\n\n` +
              `Please proceed with payment to complete the collaboration.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Payment Required**",
              subtitle: "Complete the payment to finalize the collaboration:",
              buttons: [
                {
                  id: "proceed_to_payment",
                  text: "Proceed to Payment",
                  style: "success",
                  action: "proceed_to_payment",
                },
              ],
              flow_state: "payment_pending",
              message_type: "brand_owner_payment",
              visible_to: "brand_owner",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Negotiated Price Accepted**\n\nYou have accepted the negotiated price offer.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "reject_negotiated_price":
        case "reject_final_price":
          // Influencer rejects negotiated price
          newFlowState = "chat_closed";
          newAwaitingRole = null;

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `❌ **Price Offer Rejected**\n\nInfluencer has rejected your negotiated price offer. The chat is now closed.`,
            message_type: "automated",
            action_required: false,
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Negotiated Price Rejected**\n\nYou have rejected the negotiated price offer.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "continue_negotiate":
          // Influencer wants to continue negotiating
          newFlowState = "brand_owner_negotiation";
          newAwaitingRole = "brand_owner";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `🤝 **Continued Negotiation Request**\n\nInfluencer wants to continue negotiating the price. Please respond to this request.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Negotiation Response**",
              subtitle:
                "Choose how you'd like to respond to the continued negotiation request:",
              buttons: [
                {
                  id: "agree_negotiation",
                  text: "Agree to Negotiate",
                  style: "success",
                  action: "handle_negotiation",
                  data: { action: "agree" },
                },
                {
                  id: "reject_negotiation",
                  text: "Reject Negotiation",
                  style: "danger",
                  action: "handle_negotiation",
                  data: { action: "reject" },
                },
              ],
              flow_state: "brand_owner_negotiation",
              message_type: "brand_owner_negotiation_response",
              visible_to: "brand_owner",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Continued Negotiation Requested**\n\nYou have requested to continue negotiating the price.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "submit_work":
        case "resubmit_work":
          // Influencer submits work (initial or resubmission after revision)
          const isResubmission = action === "resubmit_work";
          const currentRevisionCount = conversation.flow_data?.revision_count || 0;
          const maxRevisions = conversation.flow_data?.max_revisions || 3;
          
          newFlowState = "work_submitted";
          newAwaitingRole = "brand_owner";

          // Prepare work submission data
          const workSubmissionData = {
            deliverables: data.deliverables || data.message || "Work submitted",
            description: data.description || data.message || "Work completed as requested",
            submission_notes: data.submission_notes || data.notes || "",
            submitted_at: new Date().toISOString(),
            attachments: data.attachments || [],
            revision_number: isResubmission ? currentRevisionCount : 0
          };

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `📤 **Work Submitted**${isResubmission ? ` (Revision ${currentRevisionCount})` : ''}\n\n**Description:** ${workSubmissionData.description}\n\n${workSubmissionData.submission_notes ? `**Notes:** ${workSubmissionData.submission_notes}\n\n` : ''}${workSubmissionData.attachments && workSubmissionData.attachments.length > 0 ? `**Attachments:** ${workSubmissionData.attachments.length} file(s)\n\n` : ''}Please review the submitted work and provide your feedback.`,
            message_type: "automated",
            action_required: true,
            attachment_metadata: workSubmissionData.attachments && workSubmissionData.attachments.length > 0 ? workSubmissionData.attachments : null,
            action_data: {
              title: "🎯 **Work Review Required**",
              subtitle: "Please review the submitted work and provide feedback:",
              work_submission: workSubmissionData,
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
              })(),
              flow_state: "work_submitted",
              message_type: "work_review",
              visible_to: "brand_owner",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.influencer_id,
            message: `✅ **Action Taken: Work Submitted**\n\nYou have submitted your work${isResubmission ? ` (Revision ${currentRevisionCount})` : ''} for review.`,
            message_type: "audit",
            action_required: false,
          };

          // Update conversation with work submission data and change chat_status to automated
          const { error: workUpdateError } = await supabaseAdmin
            .from("conversations")
            .update({
              // Store work submission data in flow_data since work_submission column doesn't exist
              flow_data: {
                ...conversation.flow_data,
                work_submission: workSubmissionData,
                submission_date: new Date().toISOString(),
                work_status: "submitted"
              },
              chat_status: "automated" // Change from real_time to automated
            })
            .eq("id", conversationId);
            
          if (workUpdateError) {
            throw new Error(`Failed to update conversation: ${workUpdateError.message}`);
          }
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

      // Create messages (INFLUENCER ACTION HANDLER)
      const messagesToCreate = [newMessage];
      if (auditMessage) {
        messagesToCreate.push(auditMessage);
      }

      console.log("🔍 [DEBUG] About to create messages in influencer action:");
      console.log("  - Messages to create:", messagesToCreate.length);
      console.log("  - First message:", JSON.stringify(newMessage, null, 2));
      if (auditMessage) {
        console.log(
          "  - Audit message:",
          JSON.stringify(auditMessage, null, 2)
        );
      }

      // Validate message structure before insertion
      console.log("🔍 [DEBUG] Validating message structure...");
      messagesToCreate.forEach((msg, index) => {
        console.log(`  Message ${index + 1}:`);
        console.log(
          `    - conversation_id: ${
            msg.conversation_id
          } (type: ${typeof msg.conversation_id})`
        );
        console.log(
          `    - sender_id: ${msg.sender_id} (type: ${typeof msg.sender_id})`
        );
        console.log(
          `    - receiver_id: ${
            msg.receiver_id
          } (type: ${typeof msg.receiver_id})`
        );
        console.log(`    - message: ${msg.message?.substring(0, 50)}...`);
        console.log(
          `    - message_type: ${
            msg.message_type
          } (type: ${typeof msg.message_type})`
        );
        console.log(
          `    - action_required: ${
            msg.action_required
          } (type: ${typeof msg.action_required})`
        );
        console.log(
          `    - action_data: ${msg.action_data ? "present" : "null"}`
        );
        console.log(
          `    - is_automated: ${
            msg.is_automated
          } (type: ${typeof msg.is_automated})`
        );
        console.log(
          `    - action_completed: ${
            msg.action_completed
          } (type: ${typeof msg.action_completed})`
        );
      });

      // Test insert each message individually to identify which one fails
      console.log("🧪 [DEBUG] Testing individual message insertion...");
      for (let i = 0; i < messagesToCreate.length; i++) {
        const msg = messagesToCreate[i];
        console.log(`  Testing message ${i + 1}...`);

        try {
          const { data: testResult, error: testError } = await supabaseAdmin
            .from("messages")
            .insert(msg)
            .select();

          if (testError) {
            console.error(
              `❌ [DEBUG] Message ${i + 1} failed:`,
              testError.message
            );
            if (testError.message.includes("check constraint")) {
              console.error(
                `🔍 [DEBUG] Check constraint violation on message ${i + 1}:`
              );
              console.error(`  - message_type: ${msg.message_type}`);
              console.error(`  - action_required: ${msg.action_required}`);
              console.error(
                `  - action_data: ${msg.action_data ? "present" : "null"}`
              );
            }
          } else {
            console.log(`✅ [DEBUG] Message ${i + 1} test insert successful`);
            // Clean up test insert
            await supabaseAdmin
              .from("messages")
              .delete()
              .eq("id", testResult[0].id);
          }
        } catch (testErr) {
          console.error(`❌ [DEBUG] Error testing message ${i + 1}:`, testErr);
        }
      }

      const { data: createdMessages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messagesToCreate)
        .select();

      if (messageError) {
        console.error(
          "❌ [DEBUG] Message creation failed in influencer action:"
        );
        console.error("  - Error details:", messageError);
        console.error("  - Error message:", messageError.message);
        console.error("  - Error code:", messageError.code);
        console.error("  - Error details:", messageError.details);
        console.error("  - Error hint:", messageError.hint);

        // Try to identify the specific constraint violation
        if (messageError.message.includes("check constraint")) {
          console.error("🔍 [DEBUG] Check constraint violation detected!");
          console.error(
            "  - This suggests a field value is not allowed by the constraint"
          );
          console.error(
            "  - Check message_type, action_required, or other constrained fields"
          );
        }

        throw new Error(`Failed to create messages: ${messageError.message}`);
      }

      console.log(
        "✅ [DEBUG] Messages created successfully in influencer action:"
      );
      console.log("  - Created messages count:", createdMessages?.length || 0);
      if (createdMessages && createdMessages.length > 0) {
        createdMessages.forEach((msg, index) => {
          console.log(`  Message ${index + 1} ID: ${msg.id}`);
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
        audit_message: auditMessage ? createdMessages[1] : null,
      };

      // Emit WebSocket events for real-time updates
      if (this.io) {
        try {
          // Emit conversation state change
          this.io.to(`conversation_${conversationId}`).emit('conversation_state_changed', {
            conversation_id: conversationId,
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: 'automated',
            current_action_data: result.conversation.current_action_data,
            updated_at: new Date().toISOString()
          });

          // Emit new message to conversation room
          if (result.message) {
            this.io.to(`conversation_${conversationId}`).emit('new_message', {
              conversation_id: conversationId,
              message: result.message,
              conversation_context: {
                id: conversationId,
                chat_status: 'automated',
                flow_state: newFlowState,
                awaiting_role: newAwaitingRole,
                conversation_type: conversation.campaign_id ? 'campaign' : conversation.bid_id ? 'bid' : 'direct',
                automation_enabled: true,
                current_action_data: result.conversation.current_action_data
              }
            });
          }

          // Emit audit message if exists
          if (result.audit_message) {
            this.io.to(`conversation_${conversationId}`).emit('new_message', {
              conversation_id: conversationId,
              message: result.audit_message,
              conversation_context: {
                id: conversationId,
                chat_status: 'automated',
                flow_state: newFlowState,
                awaiting_role: newAwaitingRole,
                conversation_type: conversation.campaign_id ? 'campaign' : conversation.bid_id ? 'bid' : 'direct',
                automation_enabled: true,
                current_action_data: result.conversation.current_action_data
              }
            });
          }

          // Emit global conversation list updates
          this.emitGlobalConversationUpdate(conversation, conversationId, {
            flow_state: newFlowState,
            awaiting_role: newAwaitingRole,
            chat_status: 'automated',
            current_action_data: result.conversation.current_action_data,
            action: 'state_changed'
          });

          console.log("📡 [DEBUG] WebSocket events emitted for conversation:", conversationId);
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

      // Create work submission message
      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: conversation.influencer_id,
          receiver_id: conversation.brand_owner_id,
          message: `📤 **Work Submitted**${isResubmission ? ` (Revision ${conversation.revision_count || 0})` : ''}\n\n**Deliverables:** ${submissionData.deliverables}\n\n**Description:** ${submissionData.description}\n\n${submissionData.submission_notes ? `**Notes:** ${submissionData.submission_notes}` : ''}`,
          message_type: "automated", // Fixed: Changed from "system" to "automated"
          action_required: true,
          action_data: {
            title: "🎯 **Work Review Required**",
            subtitle: "Please review the submitted work and provide feedback:",
            work_submission: submissionData,
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
        })
        .select()
        .single();

      if (messageError) {
        throw new Error(`Failed to create message: ${messageError.message}`);
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
        newFlowState = "work_approved";
        newAwaitingRole = null; // Work completed, no further action needed
        
        messageText = `✅ **Work Approved!**\n\nGreat work! The collaboration has been completed successfully.${feedback ? `\n\n**Feedback:** ${feedback}` : ''}`;
        
        actionData = {
          title: "🎉 **Collaboration Completed**",
          subtitle: "The work has been approved and the collaboration is now complete.",
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
        audit_message: null,
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
        audit_message: null,
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
        audit_message: null,
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
        audit_message: null,
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
        audit_message: null
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
