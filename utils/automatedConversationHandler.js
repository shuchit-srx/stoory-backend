const { supabaseAdmin } = require("../supabase/client");

class AutomatedConversationHandler {
  constructor() {
    this.flowStates = {
      INITIAL: "initial",
      NEGOTIATING: "negotiating",
      ACCEPTED: "accepted",
      DECLINED: "declined",
      PAYMENT_PENDING: "payment_pending",
    };

    this.buttonIds = {
      // Bid flow buttons
      accept_offer: "Accept the current offer",
      negotiate_price: "Start price negotiation",
      ask_questions: "Ask questions about the bid/campaign",
      counter_negotiate: "Make a counter offer",
      not_interested_negotiate: "Not interested in negotiating",
      continue_original: "Continue with original offer",
      withdraw: "Withdraw from bid/campaign",
      decline_offer: "Decline the offer",

      // Campaign flow buttons
      discuss_campaign: "Yes, let's discuss the campaign",
      not_interested_campaign: "No, not interested",
      yes_followers: "Yes, I have the required followers",
      no_followers: "No, I don't have the required followers",
      yes_timeline: "Yes, I can deliver within timeline",
      no_timeline: "No, I cannot deliver within timeline",

      // Common buttons
      confirm_payment: "Confirm payment",
      cancel_payment: "Cancel payment",
    };
  }

  // Send automated message with buttons
  async sendAutomatedMessage(conversationId, messageType, options = {}) {
    try {
      const { message, buttons, nextState } = this.generateAutomatedMessage(
        messageType,
        options
      );

      const { data: newMessage, error } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: options.senderId,
          receiver_id: options.receiverId,
          message: message,
          message_type: messageType,
          action_data: {
            buttons: buttons,
            flow_state: nextState,
            message_type: messageType,
          },
        })
        .select()
        .single();

      if (error) throw error;

      // Update conversation flow state
      await this.updateConversationFlowState(
        conversationId,
        nextState,
        options.flowData
      );

      return newMessage;
    } catch (error) {
      console.error("Failed to send automated message:", error);
      throw error;
    }
  }

  // Generate automated message content and buttons
  generateAutomatedMessage(messageType, options) {
    switch (messageType) {
      case "automated_bid_welcome":
        return {
          message: `Hi! I see you've applied to my bid with ₹${options.bidAmount} amount. Let's discuss this.\n\nThanks for your interest! I can:`,
          buttons: [
            { id: "accept_offer", text: "Accept your offer" },
            { id: "negotiate_price", text: "Negotiate price" },
            { id: "ask_questions", text: "Ask questions" },
          ],
          nextState: this.flowStates.INITIAL,
        };

      case "automated_bid_negotiate":
        return {
          message: "What's your proposed price?",
          buttons: [], // No buttons, expect text input
          nextState: this.flowStates.NEGOTIATING,
        };

      case "automated_bid_counter_offer":
        return {
          message: `Influencer has proposed ₹${options.newAmount} (original: ₹${options.originalAmount})`,
          buttons: [
            { id: "accept_offer", text: "Accept negotiation" },
            { id: "counter_negotiate", text: "Counter-negotiate" },
            {
              id: "not_interested_negotiate",
              text: "Not interested to negotiate",
            },
          ],
          nextState: this.flowStates.NEGOTIATING,
        };

      case "automated_bid_not_interested":
        return {
          message:
            "Brand owner is not interested in negotiating. Would you like to continue with original offer or withdraw?",
          buttons: [
            { id: "continue_original", text: "Continue with original offer" },
            { id: "withdraw", text: "Withdraw" },
          ],
          nextState: this.flowStates.NEGOTIATING,
        };

      case "automated_campaign_welcome":
        return {
          message: `Hi! I'm interested in your campaign '${options.campaignTitle}'.\n\nCampaign Details:\n- Budget: ₹${options.budget}\n- Platform: ${options.platform}\n- Requirements: ${options.requirements}\n- Timeline: ${options.timeline}\n\nWould you like to discuss this campaign?`,
          buttons: [
            { id: "discuss_campaign", text: "Yes, let's discuss" },
            { id: "not_interested_campaign", text: "No, not interested" },
          ],
          nextState: this.flowStates.INITIAL,
        };

      case "automated_campaign_question_followers":
        return {
          message: "Do you have 50k+ followers on Instagram?",
          buttons: [
            { id: "yes_followers", text: "Yes" },
            { id: "no_followers", text: "No" },
          ],
          nextState: this.flowStates.NEGOTIATING,
        };

      case "automated_campaign_question_timeline":
        return {
          message: "Can you deliver 2 posts within 2 weeks?",
          buttons: [
            { id: "yes_timeline", text: "Yes" },
            { id: "no_timeline", text: "No" },
          ],
          nextState: this.flowStates.NEGOTIATING,
        };

      case "automated_campaign_price_request":
        return {
          message: "What's your price for this campaign?",
          buttons: [], // No buttons, expect text input
          nextState: this.flowStates.NEGOTIATING,
        };

      case "automated_acceptance":
        return {
          message: `Agreement reached at ₹${options.agreedAmount}! Payment will be processed...`,
          buttons: [
            { id: "confirm_payment", text: "Confirm Payment" },
            { id: "cancel_payment", text: "Cancel" },
          ],
          nextState: this.flowStates.PAYMENT_PENDING,
        };

      default:
        return {
          message: "An error occurred. Please try again.",
          buttons: [],
          nextState: this.flowStates.INITIAL,
        };
    }
  }

  // Handle button click response
  async handleButtonClick(conversationId, buttonId, userId, options = {}) {
    try {
      const conversation = await this.getConversation(conversationId);

      switch (buttonId) {
        case "accept_offer":
          return await this.handleAcceptOffer(conversation, userId);

        case "negotiate_price":
          return await this.handleNegotiatePrice(conversation, userId);

        case "ask_questions":
          return await this.handleAskQuestions(conversation, userId);

        case "counter_negotiate":
          return await this.handleCounterNegotiate(conversation, userId);

        case "not_interested_negotiate":
          return await this.handleNotInterestedNegotiate(conversation, userId);

        case "continue_original":
          return await this.handleContinueOriginal(conversation, userId);

        case "withdraw":
          return await this.handleWithdraw(conversation, userId);

        case "discuss_campaign":
          return await this.handleDiscussCampaign(conversation, userId);

        case "yes_followers":
        case "yes_timeline":
          return await this.handleYesAnswer(conversation, userId, buttonId);

        case "no_followers":
        case "no_timeline":
          return await this.handleNoAnswer(conversation, userId, buttonId);

        case "confirm_payment":
          return await this.handleConfirmPayment(conversation, userId);

        default:
          throw new Error(`Unknown button ID: ${buttonId}`);
      }
    } catch (error) {
      console.error("Error handling button click:", error);
      throw error;
    }
  }

  // Handle text input response
  async handleTextInput(conversationId, message, userId) {
    try {
      const conversation = await this.getConversation(conversationId);
      const flowState = conversation.flow_state;

      if (flowState === this.flowStates.NEGOTIATING) {
        // Extract price from message
        const price = this.extractPriceFromMessage(message);
        if (price) {
          return await this.handlePriceInput(conversation, userId, price);
        }
      }

      // Default: treat as manual message
      return await this.sendManualMessage(conversationId, message, userId);
    } catch (error) {
      console.error("Error handling text input:", error);
      throw error;
    }
  }

  // Extract price from message
  extractPriceFromMessage(message) {
    const priceRegex = /₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/;
    const match = message.match(priceRegex);
    return match ? parseFloat(match[1].replace(/,/g, "")) : null;
  }

  // Update conversation flow state
  async updateConversationFlowState(conversationId, state, flowData = {}) {
    await supabaseAdmin
      .from("conversations")
      .update({
        flow_state: state,
        flow_data: flowData,
      })
      .eq("id", conversationId);
  }

  // Get conversation with flow data
  async getConversation(conversationId) {
    const { data: conversation, error } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (error) throw error;
    return conversation;
  }

  // Handle specific button actions
  async handleAcceptOffer(conversation, userId) {
    const flowData = conversation.flow_data || {};
    const agreedAmount = flowData.current_offer || flowData.original_offer;

    // Update conversation to accepted state
    await this.updateConversationFlowState(
      conversation.id,
      this.flowStates.ACCEPTED,
      {
        ...flowData,
        agreed_amount: agreedAmount,
        accepted_by: userId,
        accepted_at: new Date().toISOString(),
      }
    );

    // Send acceptance message
    return await this.sendAutomatedMessage(
      conversation.id,
      "automated_acceptance",
      {
        senderId: userId,
        receiverId:
          conversation.brand_owner_id === userId
            ? conversation.influencer_id
            : conversation.brand_owner_id,
        agreedAmount: agreedAmount,
      }
    );
  }

  async handleNegotiatePrice(conversation, userId) {
    return await this.sendAutomatedMessage(
      conversation.id,
      "automated_bid_negotiate",
      {
        senderId: userId,
        receiverId:
          conversation.brand_owner_id === userId
            ? conversation.influencer_id
            : conversation.brand_owner_id,
      }
    );
  }

  async handleAskQuestions(conversation, userId) {
    // For now, just send a manual message prompt
    return await this.sendManualMessage(
      conversation.id,
      "Please ask your question:",
      userId
    );
  }

  async handlePriceInput(conversation, userId, price) {
    const flowData = conversation.flow_data || {};
    const isBrandOwner = conversation.brand_owner_id === userId;

    // Update flow data with new price
    const updatedFlowData = {
      ...flowData,
      current_offer: price,
      negotiation_history: [
        ...(flowData.negotiation_history || []),
        {
          price: price,
          offered_by: userId,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    await this.updateConversationFlowState(
      conversation.id,
      this.flowStates.NEGOTIATING,
      updatedFlowData
    );

    // Send counter offer message to the other party
    const messageType = isBrandOwner
      ? "automated_bid_counter_offer"
      : "automated_bid_counter_offer";
    const receiverId = isBrandOwner
      ? conversation.influencer_id
      : conversation.brand_owner_id;

    return await this.sendAutomatedMessage(conversation.id, messageType, {
      senderId: userId,
      receiverId: receiverId,
      newAmount: price,
      originalAmount: flowData.original_offer,
    });
  }

  async sendManualMessage(conversationId, message, userId) {
    const conversation = await this.getConversation(conversationId);
    const receiverId =
      conversation.brand_owner_id === userId
        ? conversation.influencer_id
        : conversation.brand_owner_id;

    const { data: newMessage, error } = await supabaseAdmin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        receiver_id: receiverId,
        message: message,
        message_type: "manual",
      })
      .select()
      .single();

    if (error) throw error;
    return newMessage;
  }

  // Placeholder methods for other button handlers
  async handleCounterNegotiate(conversation, userId) {
    return await this.handleNegotiatePrice(conversation, userId);
  }

  async handleNotInterestedNegotiate(conversation, userId) {
    return await this.sendAutomatedMessage(
      conversation.id,
      "automated_bid_not_interested",
      {
        senderId: userId,
        receiverId:
          conversation.brand_owner_id === userId
            ? conversation.influencer_id
            : conversation.brand_owner_id,
      }
    );
  }

  async handleContinueOriginal(conversation, userId) {
    const flowData = conversation.flow_data || {};
    return await this.handleAcceptOffer(conversation, userId);
  }

  async handleWithdraw(conversation, userId) {
    await this.updateConversationFlowState(
      conversation.id,
      this.flowStates.DECLINED,
      {
        declined_by: userId,
        declined_at: new Date().toISOString(),
      }
    );

    return await this.sendManualMessage(
      conversation.id,
      "Conversation ended - offer withdrawn.",
      userId
    );
  }

  async handleDiscussCampaign(conversation, userId) {
    return await this.sendAutomatedMessage(
      conversation.id,
      "automated_campaign_question_followers",
      {
        senderId: userId,
        receiverId:
          conversation.brand_owner_id === userId
            ? conversation.influencer_id
            : conversation.brand_owner_id,
      }
    );
  }

  async handleYesAnswer(conversation, userId, buttonId) {
    const flowData = conversation.flow_data || {};

    if (buttonId === "yes_followers") {
      return await this.sendAutomatedMessage(
        conversation.id,
        "automated_campaign_question_timeline",
        {
          senderId: userId,
          receiverId:
            conversation.brand_owner_id === userId
              ? conversation.influencer_id
              : conversation.brand_owner_id,
        }
      );
    } else if (buttonId === "yes_timeline") {
      return await this.sendAutomatedMessage(
        conversation.id,
        "automated_campaign_price_request",
        {
          senderId: userId,
          receiverId:
            conversation.brand_owner_id === userId
              ? conversation.influencer_id
              : conversation.brand_owner_id,
        }
      );
    }
  }

  async handleNoAnswer(conversation, userId, buttonId) {
    return await this.sendManualMessage(
      conversation.id,
      "Sorry, this campaign requires different qualifications. Thank you for your interest!",
      userId
    );
  }

  async handleConfirmPayment(conversation, userId) {
    // This would integrate with payment system
    return await this.sendManualMessage(
      conversation.id,
      "Payment confirmed! Work can now begin.",
      userId
    );
  }
}

module.exports = { AutomatedConversationHandler };
