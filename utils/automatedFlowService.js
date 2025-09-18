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
      console.log("🔍 [DEBUG] handleBrandOwnerAction called:");
      console.log("  - conversationId:", conversationId);
      console.log("  - action:", action);
      console.log("  - data:", data);

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        console.error("❌ [DEBUG] Conversation not found:", convError);
        throw new Error("Conversation not found");
      }

      console.log("✅ [DEBUG] Conversation found:", conversation.id);

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

          // Note: flow_data column removed - negotiation tracking simplified

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
          console.log("💳 [DEBUG] Processing proceed_to_payment action");
          // Brand owner proceeds to payment
          newFlowState = "payment_pending";
          newAwaitingRole = "brand_owner";

          // Get the amount from various sources
          let paymentAmount = data.amount || 0;
          
          if (paymentAmount <= 0) {
            // Prefer requests.proposed_amount, then final_agreed_amount
            if (conversation.request_id) {
              console.log("🔎 [DEBUG] Looking up request by request_id for amount:", conversation.request_id);
              const { data: request } = await supabaseAdmin
                .from("requests")
                .select("proposed_amount, final_agreed_amount")
                .eq("id", conversation.request_id)
                .single();
              console.log("🔎 [DEBUG] Request row:", request);
              if (request?.proposed_amount && parseFloat(request.proposed_amount) > 0) {
                paymentAmount = parseFloat(request.proposed_amount);
                console.log("💰 [DEBUG] Got amount from request.proposed_amount:", paymentAmount);
              } else if (request?.final_agreed_amount && parseFloat(request.final_agreed_amount) > 0) {
                paymentAmount = parseFloat(request.final_agreed_amount);
                console.log("💰 [DEBUG] Got amount from request.final_agreed_amount:", paymentAmount);
              }
            }
            // If no linked request, attempt to find one by bid_id + influencer_id
            if (paymentAmount <= 0 && conversation.bid_id && conversation.influencer_id) {
              console.log("🔎 [DEBUG] Looking up request by pair (bid_id, influencer_id):", conversation.bid_id, conversation.influencer_id);
              const { data: reqByPair } = await supabaseAdmin
                .from("requests")
                .select("id, proposed_amount, final_agreed_amount")
                .eq("bid_id", conversation.bid_id)
                .eq("influencer_id", conversation.influencer_id)
                .order("updated_at", { ascending: false })
                .limit(1)
                .single();
              console.log("🔎 [DEBUG] Pair request row:", reqByPair);
              if (reqByPair) {
                if (reqByPair.proposed_amount && parseFloat(reqByPair.proposed_amount) > 0) {
                  paymentAmount = parseFloat(reqByPair.proposed_amount);
                  console.log("💰 [DEBUG] Got amount from (pair) request.proposed_amount:", paymentAmount);
                } else if (reqByPair.final_agreed_amount && parseFloat(reqByPair.final_agreed_amount) > 0) {
                  paymentAmount = parseFloat(reqByPair.final_agreed_amount);
                  console.log("💰 [DEBUG] Got amount from (pair) request.final_agreed_amount:", paymentAmount);
                }
                // Also backfill conversation.request_id for future
                if (reqByPair.id) {
                  console.log("🧩 [DEBUG] Backfilling conversation.request_id:", reqByPair.id);
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
              console.log("💰 [DEBUG] Got amount from flow_data:", paymentAmount);
            }
            // Try to get amount from recent price negotiation messages
            if (paymentAmount <= 0) {
              console.log("🔎 [DEBUG] Scanning last negotiation messages for amount...");
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
                  console.log("💰 [DEBUG] Got amount from message:", paymentAmount);
                  break;
                }
                // Also check action_data for price
                if (msg.action_data && msg.action_data.price) {
                  paymentAmount = parseFloat(msg.action_data.price);
                  console.log("💰 [DEBUG] Got amount from action_data:", paymentAmount);
                  break;
                }
              }
            }
          }
          
          if (paymentAmount <= 0) {
            console.error("❌ [DEBUG] Payment amount is required");
            throw new Error('Payment amount is required. Ensure requests.proposed_amount/final_agreed_amount is set, or pass data.amount');
          }

          console.log("💰 [DEBUG] Payment amount:", paymentAmount);
          // Convert to paise for database storage
          const paymentAmountPaise = Math.round(paymentAmount * 100);
          console.log("💰 [DEBUG] Payment amount in paise:", paymentAmountPaise);

          // Create Razorpay order
          const Razorpay = require('razorpay');
          const keyId = process.env.RAZORPAY_KEY_ID;
          const keySecret = process.env.RAZORPAY_KEY_SECRET;
          if (!keyId || !keySecret) {
            console.error("❌ [DEBUG] Missing Razorpay keys. RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set.");
            throw new Error("Payment gateway configuration missing. Please set Razorpay keys.");
          }
          const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

          console.log("🔧 [DEBUG] Creating Razorpay order...");
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
                influencer_id: conversation.influencer_id
              }
            });
          } catch (rpErr) {
            console.error("❌ [DEBUG] Razorpay order creation failed:", rpErr);
            throw new Error(`Payment order creation failed at gateway: ${rpErr?.message || rpErr}`);
          }

          console.log("✅ [DEBUG] Razorpay order created:", razorpayOrder.id);

          // Create payment order in database
          console.log("🗃️  [DEBUG] Inserting payment_order row...");
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
                razorpay_receipt: razorpayOrder.receipt
              }
            })
            .select()
            .single();

          if (orderError) {
            console.error("❌ [DEBUG] Payment order creation failed:", orderError);
            throw new Error(`Failed to create payment order: ${orderError.message}`);
          }

          console.log("✅ [DEBUG] Payment order created in database:", paymentOrder.id);

          console.log("✉️  [DEBUG] Preparing payment prompt message for chat...");
          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.brand_owner_id,
            receiver_id: conversation.influencer_id,
            message: `💳 **Payment Required**\n\nPlease complete the payment of ₹${paymentAmount} to proceed with the collaboration.`,
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
              ]
            }
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

      // For proceed_to_payment, also update current_action_data with payment order
      if (action === "proceed_to_payment" && newMessage.action_data) {
        updateData.current_action_data = newMessage.action_data;
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

      const result = {
        success: true,
        conversation: {
          id: conversationId,
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
          current_action_data: action === "proceed_to_payment" ? newMessage.action_data : {},
        },
        message: createdMessages[0],
        audit_message: auditMessage ? createdMessages[1] : null,
      };

      console.log("✅ [DEBUG] Brand owner action completed successfully:");
      console.log("  - Flow state:", newFlowState);
      console.log("  - Awaiting role:", newAwaitingRole);
      console.log("  - Has current_action_data:", !!result.conversation.current_action_data);
      console.log("  - Message created:", !!result.message);

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
      console.log("🔍 [DEBUG] handleInfluencerAction called:");
      console.log("  - conversationId:", conversationId);
      console.log("  - action:", action);
      console.log("  - data:", data);

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
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

          // Determine agreed price: prefer requests.proposed_amount if present
          let agreedPrice = parseFloat(data.price) || 0;
          if (!agreedPrice && conversation.request_id) {
            const { data: reqForAccept } = await supabaseAdmin
              .from("requests")
              .select("proposed_amount")
              .eq("id", conversation.request_id)
              .single();
            if (reqForAccept?.proposed_amount) {
              agreedPrice = parseFloat(reqForAccept.proposed_amount);
            }
          }

          // Store the agreed price in flow_data for later retrieval
          const updatedFlowData = {
            ...conversation.flow_data,
            agreed_amount: agreedPrice,
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
              : agreedPrice;
            await supabaseAdmin
              .from("requests")
              .update({
                final_agreed_amount: finalAmount,
                status: "finalized"
              })
              .eq("id", conversation.request_id);
          }

          newMessage = {
            conversation_id: conversationId,
            sender_id: conversation.influencer_id,
            receiver_id: conversation.brand_owner_id,
            message: `✅ **Price Offer Accepted**\n\nInfluencer has agreed to the offer of ₹${data.price || 'the proposed amount'}. Please proceed with payment to complete the collaboration.`,
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

      // Create payment confirmation message
      const confirmationMessage = {
        conversation_id: conversationId,
        sender_id: SYSTEM_USER_ID,
        receiver_id: conversation.brand_owner_id,
        message: `✅ **Payment Completed Successfully**\n\nPayment of ₹${paymentData.amount} has been processed. The collaboration is now active and work can begin.`,
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

      // Update conversation to work_submitted state
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "work_submitted",
          awaiting_role: "brand_owner",
          work_submission: submissionData,
          work_submitted: true,
          submission_date: submissionData.submitted_at
        })
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
          message: `📤 **Work Submitted**\n\n**Deliverables:** ${submissionData.deliverables}\n\n**Description:** ${submissionData.description}\n\n${submissionData.submission_notes ? `**Notes:** ${submissionData.submission_notes}` : ''}`,
          message_type: "system",
          action_required: true,
          action_data: {
            title: "🎯 **Work Review Required**",
            subtitle: "Please review the submitted work and provide feedback:",
            work_submission: submissionData,
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

        // Unfreeze escrow payment
        if (conversation.request_id) {
          const { error: unfreezeError } = await supabaseAdmin.rpc(
            "unfreeze_payment",
            {
              request_uuid: conversation.request_id,
              influencer_uuid: conversation.influencer_id,
              amount: 0 // Will be calculated by the RPC function
            }
          );

          if (unfreezeError) {
            console.error("Escrow unfreeze error:", unfreezeError);
          }
        }

      } else if (action === "request_revision") {
        newFlowState = "work_in_progress";
        newAwaitingRole = "influencer";
        
        messageText = `🔄 **Revision Requested**\n\nPlease make the following changes and resubmit your work:${feedback ? `\n\n**Feedback:** ${feedback}` : ''}`;
        
        actionData = {
          title: "📝 **Work Revision Required**",
          subtitle: "Please address the feedback and resubmit your work:",
          buttons: [
            {
              id: "resubmit_work",
              text: "Resubmit Work",
              action: "resubmit_work",
              style: "primary"
            }
          ]
        };
      } else {
        throw new Error(`Unknown review action: ${action}`);
      }

      // Update conversation state
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
          work_status: action === "approve_work" ? "approved" : "revision_requested"
        })
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
          message_type: "system",
          action_required: actionData.buttons.length > 0,
          action_data: actionData
        })
        .select()
        .single();

      if (messageError) {
        throw new Error(`Failed to create message: ${messageError.message}`);
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
}

module.exports = new AutomatedFlowService();
