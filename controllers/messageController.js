const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult } = require("express-validator");
const {
  AutomatedConversationHandler,
} = require("../utils/automatedConversationHandler");

class MessageController {
  /**
   * Create a new conversation (when influencer connects to campaign/bid)
   */
  async createConversation(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { campaign_id, bid_id } = req.body;
      const influencerId = req.user.id;

      // Validate that either campaign_id or bid_id is provided, not both
      if (!campaign_id && !bid_id) {
        return res.status(400).json({
          success: false,
          message: "Either campaign_id or bid_id is required",
        });
      }

      if (campaign_id && bid_id) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot create conversation for both campaign and bid simultaneously",
        });
      }

      let brandOwnerId, sourceId, sourceType;

      if (campaign_id) {
        // Get campaign details
        const { data: campaign, error: campaignError } = await supabaseAdmin
          .from("campaigns")
          .select("created_by")
          .eq("id", campaign_id)
          .single();

        if (campaignError || !campaign) {
          return res.status(404).json({
            success: false,
            message: "Campaign not found",
          });
        }

        brandOwnerId = campaign.created_by;
        sourceId = campaign_id;
        sourceType = "campaign";
      } else {
        // Get bid details
        const { data: bid, error: bidError } = await supabaseAdmin
          .from("bids")
          .select("created_by")
          .eq("id", bid_id)
          .single();

        if (bidError || !bid) {
          return res.status(404).json({
            success: false,
            message: "Bid not found",
          });
        }

        brandOwnerId = bid.created_by;
        sourceId = bid_id;
        sourceType = "bid";
      }

      // Check if conversation already exists
      const { data: existingConversation, error: existingError } =
        await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq(sourceType === "campaign" ? "campaign_id" : "bid_id", sourceId)
          .eq("brand_owner_id", brandOwnerId)
          .eq("influencer_id", influencerId)
          .single();

      if (existingConversation) {
        return res.status(400).json({
          success: false,
          message: "Conversation already exists",
        });
      }

      // Create conversation
      const conversationData = {
        brand_owner_id: brandOwnerId,
        influencer_id: influencerId,
      };

      if (sourceType === "campaign") {
        conversationData.campaign_id = sourceId;
      } else {
        conversationData.bid_id = sourceId;
      }

      const { data: conversation, error } = await supabaseAdmin
        .from("conversations")
        .insert(conversationData)
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to create conversation",
        });
      }

      // Send initial automated message if this is a bid or campaign conversation
      if (sourceType === "bid" || sourceType === "campaign") {
        try {
          const handler = new AutomatedConversationHandler();
          const messageType =
            sourceType === "bid"
              ? "automated_bid_welcome"
              : "automated_campaign_welcome";

          // Get additional context for the message
          let messageOptions = {
            senderId: brandOwnerId,
            receiverId: influencerId,
          };

          if (sourceType === "bid") {
            // Get bid context
            const { data: bid } = await supabaseAdmin
              .from("bids")
              .select("*")
              .eq("id", sourceId)
              .single();

            const { data: request } = await supabaseAdmin
              .from("requests")
              .select("*")
              .eq("bid_id", sourceId)
              .eq("influencer_id", influencerId)
              .single();

            messageOptions.bidAmount =
              request?.final_agreed_amount || bid?.min_budget;
          } else if (sourceType === "campaign") {
            // Get campaign context
            const { data: campaign } = await supabaseAdmin
              .from("campaigns")
              .select("*")
              .eq("id", sourceId)
              .single();

            messageOptions.campaignTitle = campaign?.title || "Campaign";
            messageOptions.budget = campaign?.budget || "TBD";
            messageOptions.platform = "Instagram"; // This should come from campaign data
            messageOptions.requirements = campaign?.requirements || "TBD";
            messageOptions.timeline = "2 weeks"; // This should come from campaign data
          }

          await handler.sendAutomatedMessage(
            conversation.id,
            messageType,
            messageOptions
          );
        } catch (error) {
          console.error("Failed to send automated message:", error);
          // Don't fail the conversation creation if automated message fails
        }
      }

      res.status(201).json({
        success: true,
        conversation: conversation,
        message: "Conversation created successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get conversations for a user
   */
  async getConversations(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      // Get conversations where user is involved (simplified query)
      const {
        data: conversations,
        error,
        count,
      } = await supabaseAdmin
        .from("conversations")
        .select(
          `
                    *,
                    brand_owner:users!conversations_brand_owner_id_fkey (
                        id,
                        name,
                        phone,
                        email,
                        role
                    ),
                    influencer:users!conversations_influencer_id_fkey (
                        id,
                        name,
                        phone,
                        email,
                        role
                    )
                `
        )
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch conversations",
        });
      }

      // Format conversations (simplified)
      const formattedConversations = conversations.map((conversation) => {
        return {
          ...conversation,
          source_type: conversation.request_id ? "campaign" : "direct",
          last_message: null, // Will be populated separately if needed
          unread_count: 0, // Will be calculated separately if needed
        };
      });

      res.json({
        success: true,
        conversations: formattedConversations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get messages for a specific conversation
   */
  async getMessages(req, res) {
    try {
      const { conversation_id } = req.params;
      const userId = req.user.id;
      const { page = 1, limit = 50 } = req.query;
      const offset = (page - 1) * limit;

      console.log("Getting messages for conversation:", conversation_id);

      // Check if user has access to this conversation
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("*")
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        console.log("Conversation not found:", conversation_id);
        console.log("Error:", conversationError);
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Access check: either participant can read
      const isInfluencer = conversation.influencer_id === userId;
      const isBrandOwner = conversation.brand_owner_id === userId;
      const hasAccess = isInfluencer || isBrandOwner;

      if (!hasAccess && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Get messages
      const {
        data: messages,
        error,
        count,
      } = await supabaseAdmin
        .from("messages")
        .select(
          `
                    *,
                    sender:users!messages_sender_id_fkey (
                        id,
                        phone,
                        email,
                        role
                    ),
                    receiver:users!messages_receiver_id_fkey (
                        id,
                        phone,
                        email,
                        role
                    )
                `
        )
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch messages",
        });
      }

      // Mark messages as seen if user is the receiver
      const unreadMessages = messages.filter(
        (msg) => msg.receiver_id === userId && !msg.seen
      );

      if (unreadMessages.length > 0) {
        const messageIds = unreadMessages.map((msg) => msg.id);
        await supabaseAdmin
          .from("messages")
          .update({ seen: true })
          .in("id", messageIds);
      }

      res.json({
        success: true,
        messages: messages.reverse(), // Return in chronological order
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Send a message
   */
  async sendMessage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const conversation_id =
        req.params.conversation_id || req.body.conversation_id;
      const { message, media_url } = req.body;

      // Check if conversation exists and user has access
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("*")
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check access permissions: either participant
      const isInfluencer = conversation.influencer_id === userId;
      const isBrandOwner = conversation.brand_owner_id === userId;

      if (!isInfluencer && !isBrandOwner && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // For conversations linked to requests, optionally restrict by chat_status
      // Allow sending when chat_status is 'realtime' or for direct connections
      if (
        (conversation.campaign_id || conversation.bid_id) &&
        conversation.chat_status !== "realtime" &&
        req.user.role !== "admin"
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Chat not enabled yet" });
      }

      // Determine receiver
      const receiverId = isInfluencer
        ? conversation.brand_owner_id
        : conversation.influencer_id;

      // Create message
      const { data: newMessage, error } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation_id,
          sender_id: userId,
          receiver_id: receiverId,
          message: message,
          media_url: media_url,
        })
        .select(
          `
                    *,
                    sender:users!messages_sender_id_fkey (
                        id,
                        phone,
                        email,
                        role
                    ),
                    receiver:users!messages_receiver_id_fkey (
                        id,
                        phone,
                        email,
                        role
                    )
                `
        )
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to send message",
        });
      }

      // Emit socket events so receiver updates in real-time
      const io = req.app.get("io");
      if (io) {
        // To everyone in this conversation room
        io.to(`conversation_${conversation_id}`).emit("new_message", {
          message: newMessage,
          conversationId: conversation_id,
        });
        // Direct notification to receiver's user room
        io.to(`user_${receiverId}`).emit("message_notification", {
          message: newMessage,
          senderId: userId,
        });
      }

      res.status(201).json({
        success: true,
        message: newMessage,
        message: "Message sent successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Mark messages as seen
   */
  async markMessagesAsSeen(req, res) {
    try {
      const { conversation_id } = req.params;
      const userId = req.user.id;

      // Check if user has access to this conversation
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("*")
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check access permissions using participants
      const isInfluencer = conversation.influencer_id === userId;
      const isBrandOwner = conversation.brand_owner_id === userId;

      if (!isInfluencer && !isBrandOwner && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Mark all unread messages as seen
      const { error } = await supabaseAdmin
        .from("messages")
        .update({ seen: true })
        .eq("conversation_id", conversation_id)
        .eq("receiver_id", userId)
        .eq("seen", false);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to mark messages as seen",
        });
      }

      res.json({
        success: true,
        message: "Messages marked as seen",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(req, res) {
    try {
      const { message_id } = req.params;
      const userId = req.user.id;

      // Check if message exists and user is the sender
      const { data: message, error: messageError } = await supabaseAdmin
        .from("messages")
        .select("sender_id, created_at")
        .eq("id", message_id)
        .single();

      if (messageError || !message) {
        return res.status(404).json({
          success: false,
          message: "Message not found",
        });
      }

      if (message.sender_id !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Check if message is recent (within 5 minutes)
      const messageTime = new Date(message.created_at);
      const currentTime = new Date();
      const timeDiff = (currentTime - messageTime) / 1000 / 60; // minutes

      if (timeDiff > 5 && req.user.role !== "admin") {
        return res.status(400).json({
          success: false,
          message: "Cannot delete messages older than 5 minutes",
        });
      }

      // Delete the message
      const { error } = await supabaseAdmin
        .from("messages")
        .delete()
        .eq("id", message_id);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to delete message",
        });
      }

      res.json({
        success: true,
        message: "Message deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get unread message count
   */
  async getUnreadCount(req, res) {
    try {
      const userId = req.user.id;

      const { data: conversations, error: conversationsError } =
        await supabaseAdmin
          .from("conversations")
          .select(
            `
                    id,
                    requests (
                        influencer_id,
                        campaigns (
                            created_by
                        )
                    )
                `
          )
          .or(
            `requests.influencer_id.eq.${userId},requests.campaigns.created_by.eq.${userId}`
          );

      if (conversationsError) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch conversations",
        });
      }

      let totalUnread = 0;
      const conversationIds = conversations.map((c) => c.id);

      if (conversationIds.length > 0) {
        const { data: unreadMessages, error: messagesError } =
          await supabaseAdmin
            .from("messages")
            .select("conversation_id")
            .in("conversation_id", conversationIds)
            .eq("receiver_id", userId)
            .eq("seen", false);

        if (!messagesError) {
          totalUnread = unreadMessages.length;
        }
      }

      res.json({
        success: true,
        unread_count: totalUnread,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Send automated message with enhanced flow support
   */
  async sendAutomatedMessage(req, res) {
    try {
      const { conversation_id, message_type, action_data } = req.body;
      const userId = req.user.id;

      // Get conversation details
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select(
            "id, brand_owner_id, influencer_id, chat_status, campaign_id, bid_id"
          )
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check if user is part of conversation
      if (
        conversation.brand_owner_id !== userId &&
        conversation.influencer_id !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Check if conversation is in automated mode
      if (conversation.chat_status !== "automated") {
        return res.status(400).json({
          success: false,
          message: "Automated messages only allowed in automated chat mode",
        });
      }

      // Generate message based on type
      const { message, receiverId, nextActionData } =
        await this.generateAutomatedMessage(
          message_type,
          action_data,
          conversation,
          userId
        );

      // Send the automated message
      const { data: newMessage, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation_id,
          sender_id: userId,
          receiver_id: receiverId,
          message: message,
          message_type: "automated",
          action_required: true,
          action_data: nextActionData,
        })
        .select()
        .single();

      if (messageError) {
        return res.status(500).json({
          success: false,
          message: "Failed to send automated message",
        });
      }

      // Update conversation status if needed
      await this.updateConversationStatus(
        conversation_id,
        message_type,
        action_data
      );

      res.json({
        success: true,
        message: "Automated message sent successfully",
        data: newMessage,
      });
    } catch (error) {
      console.error("Send automated message error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Enable real-time chat (after payment)
   */
  async enableRealtimeChat(req, res) {
    try {
      const { conversation_id } = req.params;
      const userId = req.user.id;

      // Get conversation details
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("brand_owner_id, influencer_id, chat_status, payment_completed")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check permissions
      if (
        conversation.brand_owner_id !== userId &&
        conversation.influencer_id !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Validate payment completion
      if (!conversation.payment_completed) {
        return res.status(400).json({
          success: false,
          message: "Payment must be completed before enabling real-time chat",
        });
      }

      // Update chat status
      const { error } = await supabaseAdmin
        .from("conversations")
        .update({
          chat_status: "realtime",
        })
        .eq("id", conversation_id);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to enable real-time chat",
        });
      }

      res.json({
        success: true,
        message: "Real-time chat enabled successfully",
      });
    } catch (error) {
      console.error("Enable real-time chat error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Submit work with enhanced file handling
   */
  async submitWorkInChat(req, res) {
    try {
      const {
        conversation_id,
        work_submission_link,
        work_description,
        work_files,
      } = req.body;
      const userId = req.user.id;

      // Get conversation details
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("id, influencer_id, request_id, chat_status")
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check if user is influencer
      if (conversation.influencer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Only influencer can submit work",
        });
      }

      // Check if conversation is in real-time mode
      if (conversation.chat_status !== "realtime") {
        return res.status(400).json({
          success: false,
          message: "Work can only be submitted in real-time chat mode",
        });
      }

      // Get request details
      const { data: request, error: requestError } = await supabaseAdmin
        .from("requests")
        .select("id, revoke_count, max_revokes, status")
        .eq("id", conversation.request_id)
        .single();

      if (requestError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Validate work submission
      if (!work_submission_link && (!work_files || work_files.length === 0)) {
        return res.status(400).json({
          success: false,
          message: "Please provide either a work link or upload files",
        });
      }

      // Update request with work submission
      const { error: updateError } = await supabaseAdmin
        .from("requests")
        .update({
          work_submission_link: work_submission_link || null,
          work_description: work_description,
          work_files: work_files || [],
          work_submission_date: new Date().toISOString(),
          status: "work_submitted",
        })
        .eq("id", request.id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to update work submission",
        });
      }

      // Send system message about work submission
      const { data: systemMessage, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation_id,
          sender_id: userId,
          receiver_id: conversation.brand_owner_id,
          message: `📤 Work Submitted!\n\nInfluencer has submitted the completed work.\n\n**Description:** ${work_description}\n\nBrand Owner: Please review and provide feedback.`,
          message_type: "system",
          action_required: true,
          action_data: {
            buttons: ["Approve Work", "Request Revision", "Ask Questions"],
            work_files: work_files || [],
            work_link: work_submission_link,
            revokes_remaining: request.max_revokes - request.revoke_count,
            message_type: "work_submitted",
          },
        })
        .select()
        .single();

      if (messageError) {
        return res.status(500).json({
          success: false,
          message: "Failed to send work submission message",
        });
      }

      res.json({
        success: true,
        message: "Work submitted successfully",
        data: {
          message: systemMessage,
          work_submission_date: new Date().toISOString(),
          revokes_remaining: request.max_revokes - request.revoke_count,
        },
      });
    } catch (error) {
      console.error("Submit work error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Approve work and release payment
   */
  async approveWorkInChat(req, res) {
    try {
      const { conversation_id, approval_notes } = req.body;
      const userId = req.user.id;

      // Get conversation details
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("id, brand_owner_id, request_id")
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check if user is brand owner
      if (conversation.brand_owner_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Only brand owner can approve work",
        });
      }

      // Get request details
      const { data: request, error: requestError } = await supabaseAdmin
        .from("requests")
        .select("id, influencer_id, final_agreed_amount, status")
        .eq("id", conversation.request_id)
        .single();

      if (requestError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Update request status
      const { error: updateError } = await supabaseAdmin
        .from("requests")
        .update({
          status: "work_approved",
          work_approval_date: new Date().toISOString(),
        })
        .eq("id", request.id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to update work approval",
        });
      }

      // Unfreeze payment in influencer's wallet
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from("wallets")
        .select("id, frozen_balance")
        .eq("user_id", request.influencer_id)
        .single();

      if (walletError) {
        return res.status(500).json({
          success: false,
          message: "Failed to get wallet details",
        });
      }

      // Move money from frozen to available balance
      const { error: unfreezeError } = await supabaseAdmin
        .from("wallets")
        .update({
          frozen_balance: wallet.frozen_balance - request.final_agreed_amount,
          balance: wallet.balance + request.final_agreed_amount,
        })
        .eq("id", wallet.id);

      if (unfreezeError) {
        return res.status(500).json({
          success: false,
          message: "Failed to release payment",
        });
      }

      // Record unfreeze transaction
      await supabaseAdmin.from("transactions").insert({
        wallet_id: wallet.id,
        amount: request.final_agreed_amount,
        type: "unfreeze",
        status: "completed",
        request_id: request.id,
      });

      // Close conversation
      await supabaseAdmin
        .from("conversations")
        .update({
          chat_status: "closed",
        })
        .eq("id", conversation_id);

      // Send approval message
      const { data: systemMessage, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation_id,
          sender_id: userId,
          receiver_id: request.influencer_id,
          message: `🎉 Work Approved!\n\nBrand Owner has approved your work.\n\n**Approval Notes:** ${
            approval_notes || "Work meets all requirements"
          }\n\n💰 Payment of ₹${
            request.final_agreed_amount
          } has been released to your wallet.\n\nYou can now withdraw the amount from your wallet.`,
          message_type: "system",
          action_required: false,
          action_data: {
            buttons: [
              "Withdraw Payment",
              "Rate Collaboration",
              "Start New Project",
            ],
            amount_released: request.final_agreed_amount,
            message_type: "work_approved",
          },
        })
        .select()
        .single();

      if (messageError) {
        return res.status(500).json({
          success: false,
          message: "Failed to send approval message",
        });
      }

      res.json({
        success: true,
        message: "Work approved and payment released successfully",
        data: {
          message: systemMessage,
          amount_released: request.final_agreed_amount,
          chat_status: "closed",
        },
      });
    } catch (error) {
      console.error("Approve work error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Request revision with enhanced feedback
   */
  async requestRevisionInChat(req, res) {
    try {
      const { conversation_id, revision_reason, revision_details } = req.body;
      const userId = req.user.id;

      // Get conversation details
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("id, brand_owner_id, request_id")
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check if user is brand owner
      if (conversation.brand_owner_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Only brand owner can request revisions",
        });
      }

      // Get request details
      const { data: request, error: requestError } = await supabaseAdmin
        .from("requests")
        .select("id, revoke_count, max_revokes, status")
        .eq("id", conversation.request_id)
        .single();

      if (requestError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check if revision limit exceeded
      if (request.revoke_count >= request.max_revokes) {
        return res.status(400).json({
          success: false,
          message: "Maximum revision limit reached",
        });
      }

      // Update request with revision
      const { error: updateError } = await supabaseAdmin
        .from("requests")
        .update({
          revoke_count: request.revoke_count + 1,
          work_submission_link: null,
          work_submission_date: null,
          work_description: null,
          work_files: [],
          status: "paid", // Back to paid status for resubmission
        })
        .eq("id", request.id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to update revision request",
        });
      }

      // Send system message about revision request
      const { data: systemMessage, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation_id,
          sender_id: userId,
          receiver_id: conversation.influencer_id,
          message: `🔄 Revision Requested!\n\nBrand Owner has requested changes to the work.\n\n**Reason:** ${revision_reason}\n\n**Details:** ${revision_details}\n\nInfluencer: Please review the feedback and resubmit the work.`,
          message_type: "system",
          action_required: true,
          action_data: {
            buttons: ["Resubmit Work", "Ask for Clarification"],
            revision_reason: revision_reason,
            revision_details: revision_details,
            revokes_remaining: request.max_revokes - (request.revoke_count + 1),
            message_type: "revision_requested",
          },
        })
        .select()
        .single();

      if (messageError) {
        return res.status(500).json({
          success: false,
          message: "Failed to send revision request message",
        });
      }

      res.json({
        success: true,
        message: "Revision requested successfully",
        data: {
          message: systemMessage,
          revoke_count: request.revoke_count + 1,
          revokes_remaining: request.max_revokes - (request.revoke_count + 1),
        },
      });
    } catch (error) {
      console.error("Request revision error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Direct connect - Brand Owner initiates conversation with influencer
   */
  async initiateDirectConnect(req, res) {
    try {
      const { influencer_id, initial_message } = req.body;
      const brand_owner_id = req.user.id;

      // Validate required fields
      if (!influencer_id) {
        return res.status(400).json({
          success: false,
          message: "influencer_id is required",
        });
      }

      if (!initial_message || initial_message.trim() === "") {
        return res.status(400).json({
          success: false,
          message: "initial_message is required and cannot be empty",
        });
      }

      // Validate user is brand owner
      if (req.user.role !== "brand_owner") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can initiate direct connections",
        });
      }

      // Validate influencer exists
      const { data: influencer, error: influencerError } = await supabaseAdmin
        .from("users")
        .select("id, role")
        .eq("id", influencer_id)
        .single();

      if (influencerError || !influencer) {
        return res.status(404).json({
          success: false,
          message: "Influencer not found",
        });
      }

      if (influencer.role !== "influencer") {
        return res.status(400).json({
          success: false,
          message: "Target user is not an influencer",
        });
      }

      // Check if conversation already exists
      const { data: existingConversation } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("brand_owner_id", brand_owner_id)
        .eq("influencer_id", influencer_id)
        .is("campaign_id", null)
        .is("bid_id", null)
        .single();

      if (existingConversation) {
        console.log("Direct connection already exists:", {
          brand_owner_id,
          influencer_id,
          existing_conversation_id: existingConversation.id,
        });
        return res.status(400).json({
          success: false,
          message: "Direct connection already exists with this influencer",
          data: {
            existing_conversation_id: existingConversation.id,
          },
        });
      }

      // Create direct conversation
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .insert({
            brand_owner_id: brand_owner_id,
            influencer_id: influencer_id,
            chat_status: "realtime", // Direct connect is always real-time
            payment_required: false,
            payment_completed: true, // No payment required for direct connect
          })
          .select()
          .single();

      if (conversationError) {
        return res.status(500).json({
          success: false,
          message: "Failed to create conversation",
        });
      }

      // Send initial message from brand owner
      const { error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          sender_id: brand_owner_id,
          receiver_id: influencer_id,
          message: initial_message,
          message_type: "manual",
        });

      if (messageError) {
        return res.status(500).json({
          success: false,
          message: "Failed to send initial message",
        });
      }

      res.json({
        success: true,
        message: "Direct connection initiated successfully",
        data: {
          conversation_id: conversation.id,
          initial_message: initial_message,
        },
      });
    } catch (error) {
      console.error("Direct connect error:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        body: req.body,
        user: req.user,
      });
      res.status(500).json({
        success: false,
        message: "Internal server error",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  /**
   * Handle button click in automated conversation
   */
  async handleButtonClick(req, res) {
    try {
      const { conversation_id } = req.params;
      const { button_id, options = {} } = req.body;
      const userId = req.user.id;

      const handler = new AutomatedConversationHandler();
      const result = await handler.handleButtonClick(
        conversation_id,
        button_id,
        userId,
        options
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Button click error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Handle text input in automated conversation
   */
  async handleTextInput(req, res) {
    try {
      const { conversation_id } = req.params;
      const { message } = req.body;
      const userId = req.user.id;

      const handler = new AutomatedConversationHandler();
      const result = await handler.handleTextInput(
        conversation_id,
        message,
        userId
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Text input error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Debug endpoint to check conversation status
   */
  async debugConversation(req, res) {
    try {
      const { conversation_id } = req.params;
      const userId = req.user.id;

      console.log("Debug request for conversation:", conversation_id);

      // Get conversation details
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("*")
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        // Get all recent conversations for debugging
        const { data: allConversations } = await supabaseAdmin
          .from("conversations")
          .select("id, brand_owner_id, influencer_id, chat_status, created_at")
          .order("created_at", { ascending: false })
          .limit(10);

        return res.status(404).json({
          success: false,
          message: "Conversation not found",
          debug: {
            requested_id: conversation_id,
            error: conversationError,
            recent_conversations: allConversations,
          },
        });
      }

      // Get messages for this conversation
      const { data: messages, error: messagesError } = await supabaseAdmin
        .from("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: true });

      res.json({
        success: true,
        conversation: conversation,
        messages: messages || [],
        message_count: messages?.length || 0,
        user_id: userId,
        has_access:
          conversation.brand_owner_id === userId ||
          conversation.influencer_id === userId,
      });
    } catch (error) {
      console.error("Debug conversation error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  /**
   * Get direct connections for brand owner
   */
  async getDirectConnections(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;

      let queryBuilder = supabaseAdmin
        .from("conversations")
        .select(
          `
          id,
          created_at,
          chat_status,
          brand_owner_id,
          influencer_id,
          influencer:users!conversations_influencer_id_fkey(
            id,
            name,
            email,
            phone,
            role,
            languages,
            categories,
            min_range,
            max_range
          )
        `
        )
        .is("campaign_id", null)
        .is("bid_id", null);

      // Filter based on user role
      if (req.user.role === "brand_owner") {
        queryBuilder = queryBuilder.eq("brand_owner_id", userId);
      } else if (req.user.role === "influencer") {
        queryBuilder = queryBuilder.eq("influencer_id", userId);
      }

      // Add pagination
      const offset = (page - 1) * limit;
      queryBuilder = queryBuilder.range(offset, offset + limit - 1);
      queryBuilder = queryBuilder.order("created_at", { ascending: false });

      const { data: conversations, error } = await queryBuilder;

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch direct connections",
        });
      }

      res.json({
        success: true,
        data: {
          conversations: conversations,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: conversations.length,
          },
        },
      });
    } catch (error) {
      console.error("Get direct connections error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Send message in direct connection (restricted)
   */
  async sendDirectMessage(req, res) {
    try {
      const { conversation_id, message } = req.body;
      const userId = req.user.id;

      // Get conversation details
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("id, brand_owner_id, influencer_id, chat_status")
          .eq("id", conversation_id)
          .single();

      if (conversationError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check if user is part of conversation
      if (
        conversation.brand_owner_id !== userId &&
        conversation.influencer_id !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Check if it's a direct connection (no campaign/bid)
      const { data: directCheck } = await supabaseAdmin
        .from("conversations")
        .select("campaign_id, bid_id")
        .eq("id", conversation_id)
        .single();

      if (directCheck.campaign_id || directCheck.bid_id) {
        return res.status(400).json({
          success: false,
          message: "This is not a direct connection",
        });
      }

      // For direct connections, brand owner can only send first message
      if (req.user.role === "brand_owner") {
        const { data: existingMessages } = await supabaseAdmin
          .from("messages")
          .select("id")
          .eq("conversation_id", conversation_id)
          .eq("sender_id", userId);

        if (existingMessages && existingMessages.length > 1) {
          return res.status(403).json({
            success: false,
            message:
              "Brand owner can only send the initial message in direct connections",
          });
        }
      }

      // Send message
      const { data: newMessage, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation_id,
          sender_id: userId,
          receiver_id:
            conversation.brand_owner_id === userId
              ? conversation.influencer_id
              : conversation.brand_owner_id,
          message: message,
          message_type: "manual",
        })
        .select()
        .single();

      if (messageError) {
        return res.status(500).json({
          success: false,
          message: "Failed to send message",
        });
      }

      res.json({
        success: true,
        message: "Message sent successfully",
        data: newMessage,
      });
    } catch (error) {
      console.error("Send direct message error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Generate automated message content based on type
   */
  async generateAutomatedMessage(
    messageType,
    actionData,
    conversation,
    userId
  ) {
    const isBrandOwner = conversation.brand_owner_id === userId;
    const isInfluencer = conversation.influencer_id === userId;

    switch (messageType) {
      case "connection_response":
        return this.handleConnectionResponse(
          actionData,
          conversation,
          isBrandOwner
        );

      case "request_description":
        return this.handleRequestDescription(conversation, isInfluencer);

      case "provide_description":
        return this.handleProvideDescription(
          actionData,
          conversation,
          isBrandOwner
        );

      case "request_budget_negotiation":
        return this.handleRequestBudgetNegotiation(conversation, isInfluencer);

      case "budget_negotiation":
        return this.handleBudgetNegotiation(
          actionData,
          conversation,
          isBrandOwner
        );

      case "budget_response":
        return this.handleBudgetResponse(
          actionData,
          conversation,
          isInfluencer
        );

      case "ask_question":
        return this.handleAskQuestion(conversation, isInfluencer);

      case "question_response":
        return this.handleQuestionResponse(
          actionData,
          conversation,
          isBrandOwner
        );

      default:
        return this.handleDefaultAutomatedMessage(
          messageType,
          actionData,
          conversation,
          userId
        );
    }
  }

  /**
   * Handle connection response (accept/reject)
   */
  async handleConnectionResponse(actionData, conversation, isBrandOwner) {
    if (!isBrandOwner) {
      throw new Error("Only brand owners can respond to connections");
    }

    const response = actionData.response;
    const receiverId = conversation.influencer_id;

    if (response === "accept") {
      return {
        message:
          "✅ Connection Accepted!\n\nInfluencer: @influencer_name is now connected.\n\nInfluencer will respond with their next action.",
        receiverId,
        nextActionData: {
          buttons: ["Ask for Description", "Negotiate Budget", "Ask Question"],
          message_type: "connection_confirmed",
        },
      };
    } else {
      return {
        message:
          "❌ Connection Declined\n\nThank you for your interest. The brand owner has declined this connection.",
        receiverId,
        nextActionData: {
          buttons: ["Browse Other Campaigns", "Apply to Similar Campaigns"],
          message_type: "connection_declined",
        },
      };
    }
  }

  /**
   * Handle description request
   */
  async handleRequestDescription(conversation, isInfluencer) {
    if (!isInfluencer) {
      throw new Error("Only influencers can request descriptions");
    }

    return {
      message:
        "📝 Description Requested\n\nInfluencer has requested a detailed description of the campaign.\n\nBrand Owner: Please provide a detailed description.",
      receiverId: conversation.brand_owner_id,
      nextActionData: {
        input_type: "description",
        placeholder:
          "Describe your campaign requirements, deliverables, timeline, and any specific details...",
        max_length: 1000,
        message_type: "description_requested",
      },
    };
  }

  /**
   * Handle description provision
   */
  async handleProvideDescription(actionData, conversation, isBrandOwner) {
    if (!isBrandOwner) {
      throw new Error("Only brand owners can provide descriptions");
    }

    const description = actionData.description;
    return {
      message: `📋 Campaign Description Provided\n\nBrand Owner has provided detailed information about the campaign.\n\n**Description:**\n${description}\n\nInfluencer: What would you like to do next?`,
      receiverId: conversation.influencer_id,
      nextActionData: {
        buttons: ["Negotiate Budget", "Ask Question", "Leave Chat"],
        description: description,
        message_type: "description_provided",
      },
    };
  }

  /**
   * Handle budget negotiation request
   */
  async handleRequestBudgetNegotiation(conversation, isInfluencer) {
    if (!isInfluencer) {
      throw new Error("Only influencers can request budget negotiation");
    }

    return {
      message:
        "💰 Budget Negotiation Requested\n\nInfluencer wants to discuss the budget for this campaign.\n\nBrand Owner: How would you like to proceed?",
      receiverId: conversation.brand_owner_id,
      nextActionData: {
        buttons: [
          "Accept Current Budget",
          "Propose New Budget",
          "Decline Negotiation",
        ],
        message_type: "budget_negotiation_requested",
      },
    };
  }

  /**
   * Handle budget negotiation
   */
  async handleBudgetNegotiation(actionData, conversation, isBrandOwner) {
    if (!isBrandOwner) {
      throw new Error("Only brand owners can negotiate budget");
    }

    const response = actionData.response;
    const proposedAmount = actionData.proposed_amount;

    if (response === "propose") {
      return {
        message: `💰 Budget Proposal: ₹${proposedAmount}\n\nBrand Owner has proposed ₹${proposedAmount} for this campaign.\n\nInfluencer: How would you like to respond?`,
        receiverId: conversation.influencer_id,
        nextActionData: {
          buttons: [`Accept ₹${proposedAmount}`, "Counter Offer", "Reject"],
          proposed_amount: proposedAmount,
          message_type: "budget_proposed",
        },
      };
    } else if (response === "accept_current") {
      return {
        message:
          "✅ Current Budget Accepted\n\nBrand Owner has accepted the current budget.\n\nInfluencer: Please confirm to proceed.",
        receiverId: conversation.influencer_id,
        nextActionData: {
          buttons: ["Confirm", "Request Changes"],
          message_type: "budget_accepted",
        },
      };
    } else {
      return {
        message:
          "❌ Budget Negotiation Declined\n\nBrand Owner has declined to negotiate the budget.\n\nInfluencer: You can ask for description or leave the chat.",
        receiverId: conversation.influencer_id,
        nextActionData: {
          buttons: ["Ask for Description", "Leave Chat"],
          message_type: "budget_declined",
        },
      };
    }
  }

  /**
   * Handle budget response from influencer
   */
  async handleBudgetResponse(actionData, conversation, isInfluencer) {
    if (!isInfluencer) {
      throw new Error("Only influencers can respond to budget proposals");
    }

    const response = actionData.response;
    const counterAmount = actionData.counter_amount;

    if (response === "accept") {
      return {
        message:
          "✅ Budget Accepted\n\nGreat! The budget has been agreed upon.\n\nBrand Owner: Please proceed to payment to start the collaboration.",
        receiverId: conversation.brand_owner_id,
        nextActionData: {
          buttons: ["Proceed to Payment", "Finalize Agreement"],
          message_type: "budget_accepted",
        },
      };
    } else if (response === "counter") {
      return {
        message: `💰 Counter Offer: ₹${counterAmount}\n\nInfluencer has proposed ₹${counterAmount}.\n\nBrand Owner: How would you like to respond?`,
        receiverId: conversation.brand_owner_id,
        nextActionData: {
          buttons: [`Accept ₹${counterAmount}`, "Final Offer", "Reject"],
          counter_amount: counterAmount,
          message_type: "budget_countered",
        },
      };
    } else {
      return {
        message:
          "❌ Budget Rejected\n\nInfluencer has rejected the budget proposal.\n\nBrand Owner: You can propose a new budget or close the chat.",
        receiverId: conversation.brand_owner_id,
        nextActionData: {
          buttons: ["Propose New Budget", "Close Chat"],
          message_type: "budget_rejected",
        },
      };
    }
  }

  /**
   * Handle question request
   */
  async handleAskQuestion(conversation, isInfluencer) {
    if (!isInfluencer) {
      throw new Error("Only influencers can ask questions");
    }

    return {
      message:
        "❓ Question Requested\n\nInfluencer has a question about the campaign.\n\nBrand Owner: Please answer the question.",
      receiverId: conversation.brand_owner_id,
      nextActionData: {
        input_type: "question_response",
        placeholder: "Answer the influencer's question...",
        max_length: 500,
        message_type: "question_requested",
      },
    };
  }

  /**
   * Handle question response
   */
  async handleQuestionResponse(actionData, conversation, isBrandOwner) {
    if (!isBrandOwner) {
      throw new Error("Only brand owners can answer questions");
    }

    const answer = actionData.answer;
    return {
      message: `❓ Question Answered\n\nBrand Owner has answered your question.\n\n**Answer:**\n${answer}\n\nInfluencer: What would you like to do next?`,
      receiverId: conversation.influencer_id,
      nextActionData: {
        buttons: [
          "Ask Another Question",
          "Negotiate Budget",
          "Ask for Description",
          "Leave Chat",
        ],
        answer: answer,
        message_type: "question_answered",
      },
    };
  }

  /**
   * Handle default automated messages
   */
  async handleDefaultAutomatedMessage(
    messageType,
    actionData,
    conversation,
    userId
  ) {
    // Handle existing automated message types
    const message = this.generateAutomatedMessage(messageType, actionData);
    const receiverId =
      conversation.brand_owner_id === userId
        ? conversation.influencer_id
        : conversation.brand_owner_id;

    return {
      message,
      receiverId,
      nextActionData: actionData,
    };
  }

  /**
   * Update conversation status based on message type
   */
  async updateConversationStatus(conversationId, messageType, actionData) {
    let newStatus = null;

    switch (messageType) {
      case "connection_response":
        newStatus = actionData.response === "accept" ? "connected" : "declined";
        break;
      case "provide_description":
        newStatus = "description_provided";
        break;
      case "budget_negotiation":
        newStatus = "budget_negotiating";
        break;
      case "budget_response":
        if (actionData.response === "accept") {
          newStatus = "budget_agreed";
        }
        break;
    }

    if (newStatus) {
      await supabaseAdmin
        .from("conversations")
        .update({ chat_status: newStatus })
        .eq("id", conversationId);
    }
  }

  /**
   * Generate automated message content
   */
  generateAutomatedMessage(messageType, actionData) {
    switch (messageType) {
      case "negotiation_start":
        return "🤝 Let's start negotiating! What's your proposed rate for this project?";

      case "price_proposal":
        return `💰 Price Proposal: ₹${actionData?.amount}\n\n${
          actionData?.description || ""
        }`;

      case "price_counter":
        return `💬 Counter Offer: ₹${actionData?.amount}\n\n${
          actionData?.reason || ""
        }`;

      case "agreement_reached":
        return `✅ Agreement Reached!\n\nFinal Amount: ₹${actionData?.amount}\nMax Revisions: ${actionData?.max_revokes}\n\nPlease proceed with payment to continue.`;

      case "payment_required":
        return "💳 Payment Required!\n\nPlease complete the payment to enable real-time chat and start working.";

      case "payment_completed":
        return "✅ Payment Completed!\n\nReal-time chat is now enabled. You can start working and submit your work when ready.";

      case "work_reminder":
        return "⏰ Work Reminder!\n\nDon't forget to submit your work when it's ready.";

      default:
        return "System message";
    }
  }
}

// Validation middleware
const validateSendMessage = [
  // conversation_id can be provided in URL params or body
  body("conversation_id")
    .optional()
    .isUUID()
    .withMessage("Invalid conversation ID"),
  body("message")
    .isLength({ min: 1, max: 1000 })
    .withMessage("Message must be between 1 and 1000 characters"),
  body("media_url").optional().isURL().withMessage("Invalid media URL"),
];

module.exports = {
  MessageController: new MessageController(),
  validateSendMessage,
};
