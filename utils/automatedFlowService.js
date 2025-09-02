const { supabaseAdmin } = require("../supabase/client");

// System user ID for automated messages
const SYSTEM_USER_ID =
  process.env.SYSTEM_USER_ID || "00000000-0000-0000-0000-000000000000";

class AutomatedFlowService {
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
        chat_status: "automated",
        flow_data: {
          proposed_amount: proposedAmount,
          bid_title: bid.title,
          bid_description: bid.description,
          min_budget: bid.min_budget,
          max_budget: bid.max_budget,
          negotiation_count: 0,
          max_negotiations: 3,
        },
        automation_enabled: true,
        conversation_type: "bid",
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

      // Insert both messages: initial message and audit message
      const messagesToInsert = [initialMessage, auditMessage];
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
   * Handle brand owner actions in the automated flow
   */
  async handleBrandOwnerAction(conversationId, action, data = {}) {
    try {
      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*, flow_data")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

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
          newFlowState = "influencer_price_response";
          newAwaitingRole = "influencer";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💰 **Price Offer**\n\nBrand owner has offered: **₹${data.price}**\n\nPlease review and respond to this offer.`,
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
              flow_state: "influencer_price_response",
              message_type: "influencer_price_response",
              visible_to: "influencer",
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Action Taken: Price Offer Sent**\n\nYou have offered ₹${data.price} to the influencer.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        case "handle_negotiation":
          // Brand owner handles negotiation
          if (data.action === "agree") {
            newFlowState = "negotiation_input";
            newAwaitingRole = "brand_owner";

            newMessage = {
              conversation_id: conversationId,
              sender_id: conversation.brand_owner_id,
              receiver_id: conversation.influencer_id,
              message: `🤝 **Negotiation Accepted**\n\nBrand owner has agreed to negotiate. Please enter a new price offer.`,
              message_type: "automated",
              action_required: true,
              action_data: {
                title: "🎯 **New Price Offer**",
                subtitle:
                  "Enter a new price offer (must be different from the previous offer):",
                input_field: {
                  id: "new_price",
                  type: "number",
                  placeholder: "Enter new price amount",
                  required: true,
                  min: 1,
                },
                submit_button: {
                  text: "Send New Offer",
                  style: "success",
                },
                flow_state: "negotiation_input",
                message_type: "brand_owner_negotiation_input",
                visible_to: "brand_owner",
              },
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

          // Update negotiation count
          const updatedFlowData = {
            ...conversation.flow_data,
            negotiation_count:
              (conversation.flow_data.negotiation_count || 0) + 1,
          };

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💰 **Negotiated Price Offer**\n\nBrand owner has offered a new price: **₹${data.price}**\n\nThis is negotiation round ${updatedFlowData.negotiation_count}/${updatedFlowData.max_negotiations}.`,
            message_type: "automated",
            action_required: true,
            action_data: {
              title: "🎯 **Final Price Response**",
              subtitle:
                updatedFlowData.negotiation_count >=
                updatedFlowData.max_negotiations
                  ? "This is the final offer. You can only accept or reject."
                  : "Choose how you'd like to respond to this offer:",
              buttons:
                updatedFlowData.negotiation_count >=
                updatedFlowData.max_negotiations
                  ? [
                      {
                        id: "accept_final_price",
                        text: "Accept Final Offer",
                        style: "success",
                        action: "accept_final_price",
                      },
                      {
                        id: "reject_final_price",
                        text: "Reject Final Offer",
                        style: "danger",
                        action: "reject_final_price",
                      },
                    ]
                  : [
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
          newAwaitingRole = null; // No one needs to act, payment is in progress

          // Get the agreed amount from flow_data
          const agreedAmount =
            conversation.flow_data?.agreed_amount ||
            conversation.flow_data?.proposed_amount ||
            0;

          if (agreedAmount <= 0) {
            throw new Error("No valid amount found for payment");
          }

          // Create Razorpay order
          const Razorpay = require("razorpay");
          let razorpay = null;

          if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
            razorpay = new Razorpay({
              key_id: process.env.RAZORPAY_KEY_ID,
              key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
          }

          if (!razorpay) {
            throw new Error("Payment service is not configured");
          }

          // Create Razorpay order
          const orderOptions = {
            amount: Math.round(agreedAmount * 100), // Convert to paise
            currency: "INR",
            receipt: `bid_${conversation.bid_id}_${Date.now()}`,
            notes: {
              conversation_id: conversationId,
              bid_id: conversation.bid_id,
              influencer_id: conversation.influencer_id,
              brand_owner_id: conversation.brand_owner_id,
              payment_type: "bid_collaboration",
            },
          };

          const razorpayOrder = await razorpay.orders.create(orderOptions);

          // Store payment order in database
          const { data: paymentOrder, error: orderError } = await supabaseAdmin
            .from("payment_orders")
            .insert({
              conversation_id: conversationId,
              bid_id: conversation.bid_id,
              influencer_id: conversation.influencer_id,
              brand_owner_id: conversation.brand_owner_id,
              amount: agreedAmount,
              currency: "INR",
              razorpay_order_id: razorpayOrder.id,
              status: "created",
              payment_type: "bid_collaboration",
            })
            .select()
            .single();

          if (orderError) {
            throw new Error(
              `Failed to create payment order: ${orderError.message}`
            );
          }

          // Update bid/campaign status to 'pending' (payment initiated)
          if (conversation.bid_id) {
            const { error: bidUpdateError } = await supabaseAdmin
              .from("bids")
              .update({ status: "pending" })
              .eq("id", conversation.bid_id);

            if (bidUpdateError) {
              console.warn(
                `Failed to update bid status: ${bidUpdateError.message}`
              );
            }
          } else if (conversation.campaign_id) {
            const { error: campaignUpdateError } = await supabaseAdmin
              .from("campaigns")
              .update({ status: "pending" })
              .eq("id", conversation.campaign_id);

            if (campaignUpdateError) {
              console.warn(
                `Failed to update campaign status: ${campaignUpdateError.message}`
              );
            }
          }

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💳 **Payment Initiated**\n\nPayment order has been created for **₹${agreedAmount}**.\n\nOrder ID: \`${razorpayOrder.id}\`\n\nPlease complete the payment to finalize the collaboration.`,
            message_type: "automated",
            action_required: false,
            action_data: {
              payment_order: {
                id: paymentOrder.id,
                razorpay_order_id: razorpayOrder.id,
                amount: agreedAmount,
                currency: "INR",
                razorpay_config: {
                  key_id: process.env.RAZORPAY_KEY_ID,
                  amount: Math.round(agreedAmount * 100),
                  currency: "INR",
                  order_id: razorpayOrder.id,
                  name: "Stoory Collaboration",
                  description: `Payment for bid collaboration - ₹${agreedAmount}`,
                  prefill: {
                    email: "", // Will be filled by frontend
                    contact: "", // Will be filled by frontend
                  },
                  theme: {
                    color: "#3399cc",
                  },
                },
              },
            },
          };

          auditMessage = {
            conversation_id: conversationId,
            sender_id: SYSTEM_USER_ID,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Payment Order Created**\n\nPayment order created successfully for ₹${agreedAmount}.\n\nOrder ID: \`${razorpayOrder.id}\`\n\nPlease complete the payment to finalize the collaboration.`,
            message_type: "audit",
            action_required: false,
          };
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Update conversation state
      const updateData = {
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
      };

      if (action === "send_negotiated_price") {
        updateData.flow_data = updatedFlowData;
      }

      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update(updateData)
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(
          `Failed to update conversation: ${updateError.message}`
        );
      }

      // Create messages
      const messagesToCreate = [newMessage];
      if (auditMessage) {
        messagesToCreate.push(auditMessage);
      }

      const { data: createdMessages, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messagesToCreate)
        .select();

      if (messageError) {
        throw new Error(`Failed to create messages: ${messageError.message}`);
      }

      return {
        success: true,
        conversation: {
          id: conversationId,
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
        },
        message: createdMessages[0],
        audit_message: auditMessage ? createdMessages[1] : null,
      };
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
      console.log("🔍 [DEBUG] handleInfluencerAction called:");
      console.log("  - conversationId:", conversationId);
      console.log("  - action:", action);
      console.log("  - data:", data);

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*, flow_data")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

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

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Price Offer Accepted**\n\nInfluencer has agreed to the offer. Please proceed with payment to complete the collaboration.`,
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

        case "accept_negotiated_price":
        case "accept_final_price":
          // Influencer accepts negotiated price
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Price Offer Accepted**\n\nInfluencer has agreed to the negotiated offer. Please proceed with payment to complete the collaboration.`,
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

      return {
        success: true,
        conversation: {
          id: conversationId,
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
        },
        message: createdMessages[0],
        audit_message: auditMessage ? createdMessages[1] : null,
      };
    } catch (error) {
      console.error("❌ Failed to handle influencer action:", error);
      throw error;
    }
  }

  /**
   * Handle payment completion and transition to real-time chat
   */
  async handlePaymentCompletion(conversationId, paymentData) {
    try {
      // Update conversation to real-time chat
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "real_time",
          awaiting_role: null,
          chat_status: "active",
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error(
          `Failed to update conversation: ${updateError.message}`
        );
      }

      // Create payment confirmation message
      const confirmationMessage = {
        conversation_id: conversationId,
        sender_id: SYSTEM_USER_ID,
        receiver_id: conversation.brand_owner_id,
        message: `✅ **Payment Completed Successfully**\n\nPayment of ₹${paymentData.amount} has been processed. The collaboration is now active and you can communicate in real-time.`,
        message_type: "automated",
        action_required: false,
      };

      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(confirmationMessage)
        .select()
        .single();

      if (messageError) {
        throw new Error(
          `Failed to create confirmation message: ${messageError.message}`
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
      console.error("❌ Failed to handle payment completion:", error);
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
}

module.exports = new AutomatedFlowService();
