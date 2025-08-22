const { supabaseAdmin } = require("../supabase/client");

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

      // Create conversation with automated flow
      const conversationData = {
        bid_id: bidId,
        brand_owner_id: bid.created_by,
        influencer_id: influencerId,
        flow_state: "initial",
        awaiting_role: "brand_owner",
        chat_status: "automated",
        flow_data: {
          proposed_amount: proposedAmount,
          bid_title: bid.title,
          bid_description: bid.description,
          min_budget: bid.min_budget,
          max_budget: bid.max_budget,
        },
        automation_enabled: true,
      };

      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .insert(conversationData)
          .select()
          .single();

      if (conversationError) {
        throw new Error("Failed to create conversation");
      }

      // Create initial automated message
      const messageData = {
        conversation_id: conversation.id,
        sender_id: null, // System message
        receiver_id: bid.created_by,
        message: this.generateInitialMessage(bid, influencer, proposedAmount),
        message_type: "automated",
        action_required: true,
        action_data: this.generateInitialActions(),
        created_at: new Date().toISOString(),
      };

      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messageData)
        .select()
        .single();

      if (messageError) {
        throw new Error("Failed to create initial message");
      }

      return {
        success: true,
        conversation,
        message,
        flow_state: "initial",
        awaiting_role: "brand_owner",
      };
    } catch (error) {
      console.error("Error initializing bid conversation:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate initial message for brand owner
   */
  generateInitialMessage(bid, influencer, proposedAmount) {
    return `Hi! I see ${influencer.name} has applied to your bid "${bid.title}" with ₹${proposedAmount} amount.

Thanks for your interest! I can help you:`;
  }

  /**
   * Generate initial action buttons for brand owner
   */
  generateInitialActions() {
    return {
      buttons: [
        {
          id: "accept_offer",
          text: "Accept your offer",
          style: "success",
          action: "accept_offer",
        },
        {
          id: "negotiate_price",
          text: "Negotiate price",
          style: "warning",
          action: "negotiate_price",
        },
        {
          id: "ask_questions",
          text: "Ask questions",
          style: "info",
          action: "ask_questions",
        },
      ],
      flow_state: "initial",
      message_type: "brand_owner_initial",
      visible_to: "brand_owner",
    };
  }

  /**
   * Handle brand owner's response to initial bid application
   */
  async handleBrandOwnerResponse(conversationId, action, data = {}) {
    try {
      // Get conversation context
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(
          "*, bids(*), users!conversations_brand_owner_id_fkey(name), users!conversations_influencer_id_fkey(name)"
        )
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      let newFlowState, newAwaitingRole, messageData, actionData;

      switch (action) {
        case "accept_offer":
          newFlowState = "influencer_responding";
          newAwaitingRole = "influencer";
          messageData = this.generateAcceptanceMessage(conversation, data);
          actionData = this.generateAcceptanceActions();
          break;

        case "negotiate_price":
          newFlowState = "negotiating";
          newAwaitingRole = "brand_owner";
          messageData = this.generatePriceNegotiationPrompt();
          actionData = this.generatePriceInputAction();
          break;

        case "ask_questions":
          newFlowState = "negotiating";
          newAwaitingRole = "brand_owner";
          messageData = this.generateQuestionPrompt();
          actionData = this.generateQuestionInputAction();
          break;

        default:
          throw new Error("Invalid action");
      }

      // Update conversation flow state
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
          flow_data: {
            ...conversation.flow_data,
            last_action: action,
            last_action_data: data,
          },
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error("Failed to update conversation");
      }

      // Create response message
      const messageInsertData = {
        conversation_id: conversationId,
        sender_id: null, // System message
        receiver_id: conversation.influencer_id,
        message: messageData,
        message_type: "automated",
        action_required: true,
        action_data: actionData,
        created_at: new Date().toISOString(),
      };

      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messageInsertData)
        .select()
        .single();

      if (messageError) {
        throw new Error("Failed to create response message");
      }

      return {
        success: true,
        conversation: {
          ...conversation,
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
        },
        message,
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
      };
    } catch (error) {
      console.error("Error handling brand owner response:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate acceptance message for influencer
   */
  generateAcceptanceMessage(conversation, data) {
    const proposedAmount = conversation.flow_data?.proposed_amount || "N/A";
    return `Brand owner has accepted your bid application!

Bid Details:
- Title: ${conversation.bids.title}
- Amount: ₹${proposedAmount}
- Status: accepted

You can now respond to this action.`;
  }

  /**
   * Generate acceptance action buttons for influencer
   */
  generateAcceptanceActions() {
    return {
      buttons: [
        {
          id: "confirm_collaboration",
          text: "Yes, I want to continue",
          style: "success",
          action: "confirm_collaboration",
        },
        {
          id: "reject_collaboration",
          text: "No, I don't want to continue",
          style: "danger",
          action: "reject_collaboration",
        },
      ],
      flow_state: "influencer_responding",
      message_type: "influencer_acceptance_response",
      visible_to: "influencer",
    };
  }

  /**
   * Generate price negotiation prompt
   */
  generatePriceNegotiationPrompt() {
    return `What's your proposed price?

Please enter your proposed amount below:`;
  }

  /**
   * Generate price input action
   */
  generatePriceInputAction() {
    return {
      input_field: {
        type: "number",
        placeholder: "Enter your proposed amount (e.g., 5000)",
        required: true,
        min: 0,
        step: 100,
      },
      submit_button: {
        text: "Submit Price",
        style: "primary",
      },
      flow_state: "negotiating",
      message_type: "price_negotiation",
      visible_to: "brand_owner",
    };
  }

  /**
   * Generate question prompt
   */
  generateQuestionPrompt() {
    return `What would you like to ask the influencer?

Please type your question below:`;
  }

  /**
   * Generate question input action
   */
  generateQuestionInputAction() {
    return {
      input_field: {
        type: "text",
        placeholder: "Type your question here",
        required: true,
        maxLength: 500,
      },
      submit_button: {
        text: "Ask Question",
        style: "primary",
      },
      flow_state: "negotiating",
      message_type: "question_asked",
      visible_to: "brand_owner",
    };
  }

  /**
   * Handle influencer's response to brand owner's action
   */
  async handleInfluencerResponse(conversationId, action, data = {}) {
    try {
      // Get conversation context
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(
          "*, bids(*), users!conversations_brand_owner_id_fkey(name), users!conversations_influencer_id_fkey(name)"
        )
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        throw new Error("Conversation not found");
      }

      let newFlowState, newAwaitingRole, messageData, actionData;

      switch (action) {
        case "confirm_collaboration":
          newFlowState = "brand_owner_confirming";
          newAwaitingRole = "brand_owner";
          messageData =
            this.generateCollaborationConfirmedMessage(conversation);
          actionData = this.generateFinalConfirmationActions();
          break;

        case "reject_collaboration":
          newFlowState = "declined";
          newAwaitingRole = null;
          messageData = this.generateCollaborationDeclinedMessage(conversation);
          actionData = null;
          break;

        default:
          throw new Error("Invalid action");
      }

      // Update conversation flow state
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
          flow_data: {
            ...conversation.flow_data,
            last_influencer_action: action,
            last_influencer_action_data: data,
          },
        })
        .eq("id", conversationId);

      if (updateError) {
        throw new Error("Failed to update conversation");
      }

      // Create response message
      const messageInsertData = {
        conversation_id: conversationId,
        sender_id: null, // System message
        receiver_id: conversation.brand_owner_id,
        message: messageData,
        message_type: "automated",
        action_required: actionData ? true : false,
        action_data: actionData,
        created_at: new Date().toISOString(),
      };

      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert(messageInsertData)
        .select()
        .single();

      if (messageError) {
        throw new Error("Failed to create response message");
      }

      return {
        success: true,
        conversation: {
          ...conversation,
          flow_state: newFlowState,
          awaiting_role: newAwaitingRole,
        },
        message,
        flow_state: newFlowState,
        awaiting_role: newAwaitingRole,
      };
    } catch (error) {
      console.error("Error handling influencer response:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate collaboration confirmed message
   */
  generateCollaborationConfirmedMessage(conversation) {
    const proposedAmount = conversation.flow_data?.proposed_amount || "N/A";
    return `Influencer has confirmed the collaboration!

Bid Details:
- Title: ${conversation.bids.title}
- Amount: ₹${proposedAmount}
- Status: confirmed

You can now confirm to proceed to payment.`;
  }

  /**
   * Generate final confirmation actions
   */
  generateFinalConfirmationActions() {
    return {
      buttons: [
        {
          id: "proceed_to_payment",
          text: "Yes, proceed to payment",
          style: "success",
          action: "proceed_to_payment",
        },
        {
          id: "cancel_collaboration",
          text: "No, cancel",
          style: "danger",
          action: "cancel_collaboration",
        },
      ],
      flow_state: "brand_owner_confirming",
      message_type: "final_confirmation",
      visible_to: "brand_owner",
    };
  }

  /**
   * Generate collaboration declined message
   */
  generateCollaborationDeclinedMessage(conversation) {
    return `Influencer has declined the collaboration.

Status: declined

The conversation is now closed.`;
  }

  /**
   * Handle final brand owner confirmation
   */
  async handleFinalConfirmation(conversationId, action) {
    try {
      if (action === "proceed_to_payment") {
        // Update conversation to payment pending
        const { error: updateError } = await supabaseAdmin
          .from("conversations")
          .update({
            flow_state: "payment_pending",
            awaiting_role: null,
            chat_status: "completed",
          })
          .eq("id", conversationId);

        if (updateError) {
          throw new Error("Failed to update conversation");
        }

        // Create payment initiation message
        const messageData = {
          conversation_id: conversationId,
          sender_id: null,
          receiver_id: null, // Both parties
          message:
            "Both parties have confirmed the collaboration! Payment will be initiated now.",
          message_type: "automated",
          action_required: false,
          action_data: null,
          created_at: new Date().toISOString(),
        };

        const { data: message, error: messageError } = await supabaseAdmin
          .from("messages")
          .insert(messageData)
          .select()
          .single();

        if (messageError) {
          throw new Error("Failed to create payment message");
        }

        return {
          success: true,
          flow_state: "payment_pending",
          message: "Payment initiated successfully",
        };
      }

      return {
        success: false,
        error: "Invalid action",
      };
    } catch (error) {
      console.error("Error handling final confirmation:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get conversation flow context
   */
  async getConversationFlowContext(conversationId) {
    try {
      const { data: conversation, error } = await supabaseAdmin
        .from("conversations")
        .select(
          `
          *,
          bids(*),
          users!conversations_brand_owner_id_fkey(name, role),
          users!conversations_influencer_id_fkey(name, role)
        `
        )
        .eq("id", conversationId)
        .single();

      if (error || !conversation) {
        throw new Error("Conversation not found");
      }

      return {
        success: true,
        conversation,
        flow_context: {
          current_state: conversation.flow_state,
          awaiting_role: conversation.awaiting_role,
          automation_enabled: conversation.automation_enabled,
          flow_data: conversation.flow_data,
        },
      };
    } catch (error) {
      console.error("Error getting conversation flow context:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new AutomatedFlowService();
