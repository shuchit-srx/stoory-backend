const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult } = require("express-validator");
const AutomatedFlowService = require("../utils/automatedFlowService");

class MessageController {
  /**
   * Get conversations for a user based on their role
   */
  async getConversations(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      console.log(
        `🔍 Fetching conversations for user: ${userId}, page: ${page}, limit: ${limit}`
      );

      // First get the user's role
      const { data: currentUser, error: userError } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      if (userError) {
        console.error("❌ Error fetching user role:", userError);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user details",
        });
      }

      if (!currentUser) {
        console.error("❌ User not found:", userId);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      console.log(`👤 User role: ${currentUser.role}`);

      let conversationsQuery;
      let queryDescription;

      if (currentUser.role === "brand_owner") {
        // Brand owners see ALL conversations where they are the brand owner
        conversationsQuery = supabaseAdmin
          .from("conversations")
          .select(
            `
            id, brand_owner_id, influencer_id, chat_status, campaign_id, bid_id, 
            created_at, updated_at, flow_state, awaiting_role,
            campaigns(id, title, description, budget, status),
            bids(id, title, description, min_budget, max_budget, status)
          `
          )
          .eq("brand_owner_id", userId); // All conversations where they are the brand owner

        queryDescription =
          "Brand owner conversations (campaigns, bids, and direct)";
      } else if (currentUser.role === "influencer") {
        // Influencers see ALL conversations where they are the influencer
        conversationsQuery = supabaseAdmin
          .from("conversations")
          .select(
            `
            id, brand_owner_id, influencer_id, chat_status, campaign_id, bid_id, 
            created_at, updated_at, flow_state, awaiting_role,
            campaigns(id, title, description, budget, status),
            bids(id, title, description, min_budget, max_budget, status)
          `
          )
          .eq("influencer_id", userId); // All conversations where they are the influencer

        queryDescription =
          "Influencer conversations (campaigns, bids, and direct)";
      } else {
        // General users see direct conversations only (no campaigns/bids)
        conversationsQuery = supabaseAdmin
          .from("conversations")
          .select(
            `
            id, brand_owner_id, influencer_id, chat_status, campaign_id, bid_id, 
            created_at, updated_at, flow_state, awaiting_role
          `
          )
          .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`)
          .is("campaign_id", null) // No campaign
          .is("bid_id", null); // No bid

        queryDescription = "Direct conversations only";
      }

      // Execute the query with pagination
      // Note: Count with nested selects doesn't work, so we'll just return the data
      const {
        data: conversations,
        error,
      } = await conversationsQuery
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error("❌ Database error fetching conversations:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch conversations",
        });
      }

      console.log(
        `📊 Found ${
          conversations?.length || 0
        } conversations (${queryDescription})`
      );

      // Handle case where no conversations exist
      if (!conversations || conversations.length === 0) {
        return res.json({
          success: true,
          conversations: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
          },
          message: `No ${queryDescription.toLowerCase()} found`,
        });
      }

      // Get user details for conversations
      const userIds = new Set();
      conversations.forEach((conv) => {
        if (conv.brand_owner_id) userIds.add(conv.brand_owner_id);
        if (conv.influencer_id) userIds.add(conv.influencer_id);
      });

      console.log(
        `👥 Fetching details for ${userIds.size} users:`,
        Array.from(userIds)
      );

      let userMap = {};

      // Only fetch user details if there are conversations
      if (userIds.size > 0) {
        const { data: users, error: usersError } = await supabaseAdmin
          .from("users")
          .select("id, name, role, profile_image_url")
          .in("id", Array.from(userIds));

        if (usersError) {
          console.error("❌ Error fetching user details:", usersError);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch user details",
          });
        }

        console.log(`✅ Fetched ${users?.length || 0} user details`);

        users.forEach((user) => {
          userMap[user.id] = user;
        });
      } else {
        console.log("ℹ️ No users to fetch details for");
      }

      // Enrich conversations with user details and last message
      const enrichedConversations = await Promise.all(
        conversations.map(async (conv) => {
          try {
            // Get last message
            const { data: lastMessage } = await supabaseAdmin
              .from("messages")
              .select("message, created_at, sender_id")
              .eq("conversation_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .single();

            const otherUserId =
              conv.brand_owner_id === userId
                ? conv.influencer_id
                : conv.brand_owner_id;

            const otherUser = userMap[otherUserId];

            if (!otherUser) {
              console.warn(
                `⚠️ User not found for ID: ${otherUserId} in conversation: ${conv.id}`
              );
            }

            // Determine conversation type and title
            let conversationType = "direct";
            let conversationTitle = "Direct Chat";

            if (conv.campaign_id && conv.campaigns) {
              conversationType = "campaign";
              conversationTitle =
                conv.campaigns.title || "Campaign Application";
            } else if (conv.bid_id && conv.bids) {
              conversationType = "bid";
              conversationTitle = conv.bids.title || "Bid Application";
            }

            return {
              ...conv,
              other_user: otherUser || {
                id: otherUserId,
                name: "Unknown User",
                role: "unknown",
                profile_image_url: null,
              },
              last_message: lastMessage || null,
              is_brand_owner: conv.brand_owner_id === userId,
              conversation_type: conversationType,
              conversation_title: conversationTitle,
              source_data: conv.campaigns || conv.bids || null,
            };
          } catch (error) {
            console.error(`❌ Error enriching conversation ${conv.id}:`, error);
            return {
              ...conv,
              other_user: {
                id: "unknown",
                name: "Error Loading User",
                role: "unknown",
                profile_image_url: null,
              },
              last_message: null,
              is_brand_owner: conv.brand_owner_id === userId,
              conversation_type: "unknown",
              conversation_title: "Unknown Conversation",
              source_data: null,
            };
          }
        })
      );

      console.log(
        `✅ Successfully enriched ${enrichedConversations.length} conversations`
      );

      res.json({
        success: true,
        conversations: enrichedConversations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: enrichedConversations.length, // Approximate count
          has_more: enrichedConversations.length === parseInt(limit), // If we got full page, there might be more
        },
        user_role: currentUser.role,
        query_description: queryDescription,
      });
    } catch (error) {
      console.error("💥 Unexpected error in getConversations:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(req, res) {
    try {
      const { conversation_id } = req.params;
      const userId = req.user.id;
      const { page = 1, limit = 50 } = req.query;
      const offset = (page - 1) * limit;

      // Verify user is part of conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("id, brand_owner_id, influencer_id")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      if (
        conversation.brand_owner_id !== userId &&
        conversation.influencer_id !== userId
      ) {
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
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)
        .limit(limit);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch messages",
        });
      }

      // Mark messages as seen for the current user
      if (messages.length > 0) {
        await supabaseAdmin
          .from("messages")
          .update({ seen: true })
          .eq("conversation_id", conversation_id)
          .eq("receiver_id", userId)
          .eq("seen", false);
      }

      res.json({
        success: true,
        messages: messages.reverse(), // Return in chronological order
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
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
   * Send a message and create conversation if it doesn't exist
   */
  async sendMessage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.error("❌ Validation errors:", errors.array());
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const {
        conversation_id,
        message,
        media_url,
        campaign_id,
        bid_id,
        receiver_id,
        action_required,
        action_data,
      } = req.body;
      const senderId = req.user.id;

      console.log("📨 sendMessage called with payload:", {
        conversation_id,
        message,
        media_url,
        campaign_id,
        bid_id,
        receiver_id,
        senderId,
      });

      let conversationId = conversation_id;
      let receiverId = receiver_id;

      // If no conversation_id provided, we need to create one dynamically
      if (!conversation_id) {
        if (!receiver_id) {
          return res.status(400).json({
            success: false,
            message: "Either conversation_id or receiver_id is required",
          });
        }

        // Check if conversation already exists between these users
        const { data: existingConversation, error: existingError } =
          await supabaseAdmin
            .from("conversations")
            .select("id, campaign_id, bid_id")
            .or(
              `and(brand_owner_id.eq.${senderId},influencer_id.eq.${receiver_id}),and(brand_owner_id.eq.${receiver_id},influencer_id.eq.${senderId})`
            )
            .single();

        if (existingConversation) {
          conversationId = existingConversation.id;
          console.log(`✅ Found existing conversation: ${conversationId}`);
        } else {
          // Create new conversation dynamically
          console.log(
            `🆕 Creating new conversation between ${senderId} and ${receiver_id}`
          );

          const conversationData = {
            brand_owner_id:
              req.user.role === "brand_owner" ? senderId : receiver_id,
            influencer_id:
              req.user.role === "influencer" ? senderId : receiver_id,
            chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
            payment_required: false,
            payment_completed: false,
          };

          // Add campaign_id or bid_id if provided
          if (campaign_id) {
            conversationData.campaign_id = campaign_id;
          } else if (bid_id) {
            conversationData.bid_id = bid_id;
          }

          const { data: newConversation, error: convError } =
            await supabaseAdmin
              .from("conversations")
              .insert(conversationData)
              .select()
              .single();

          if (convError) {
            console.error("❌ Error creating conversation:", convError);
            return res.status(500).json({
              success: false,
              message: "Failed to create conversation",
            });
          }

          conversationId = newConversation.id;
          console.log(`✅ Created new conversation: ${conversationId}`);
        }
      }

      // Validate conversation exists and user has access
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("id, brand_owner_id, influencer_id, campaign_id, bid_id")
        .eq("id", conversationId)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Check if user is part of this conversation
      if (
        conversation.brand_owner_id !== senderId &&
        conversation.influencer_id !== senderId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied to this conversation",
        });
      }

      // Determine receiver ID from conversation
      if (!receiverId) {
        receiverId =
          conversation.brand_owner_id === senderId
            ? conversation.influencer_id
            : conversation.brand_owner_id;
      }

      // Create the message
      const { data: newMessage, error } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          receiver_id: receiverId,
          message,
          media_url,
          message_type: "user_input", // Ensure message_type is always set
          action_required: action_required || false,
          action_data: action_data || null,
        })
        .select()
        .single();

      if (error) {
        console.error("❌ Error creating message:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to send message",
        });
      }

      // Update conversation's updated_at timestamp
      await supabaseAdmin
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      // Emit real-time update
      const io = req.app.get("io");
      
      // Get conversation context for emit (moved outside if block for broader scope)
      let conversationContext = null;
      if (io) {
        const { data: conversation, error: convError } = await supabaseAdmin
          .from("conversations")
          .select("id, chat_status, flow_state, awaiting_role, campaign_id, bid_id, current_action_data")
          .eq("id", conversationId)
          .single();

        if (convError) {
        }

        // Prepare conversation context
        conversationContext = conversation ? {
          id: conversation.id,
          chat_status: conversation.chat_status,
          flow_state: conversation.flow_state,
          awaiting_role: conversation.awaiting_role,
          conversation_type: conversation.campaign_id ? 'campaign' : 
                            conversation.bid_id ? 'bid' : 'direct',
          
          current_action_data: conversation.current_action_data
        } : null;

        // Emit to conversation room: chat:new with { message }
        io.to(`room:${conversationId}`).emit('chat:new', {
          message: newMessage
        });

        // Fetch sender's name for notification
        let senderName = 'Someone';
        try {
          const { data: sender, error: senderError } = await supabaseAdmin
            .from('users')
            .select('name')
            .eq('id', senderId)
            .eq('is_deleted', false)
            .single();
          
          if (!senderError && sender && sender.name) {
            senderName = sender.name;
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch sender name for notification:', error.message);
        }

        // Store notification in database and emit to receiver
        const notificationService = require('../services/notificationService');
        notificationService.storeNotification({
          user_id: receiverId,
          type: 'message',
          title: `${senderName} sent you a message`,
          message: newMessage.message,
          data: {
            conversation_id: conversationId,
            message: newMessage,
            conversation_context: conversationContext,
            sender_id: senderId,
            receiver_id: receiverId,
            sender_name: senderName
          },
          action_url: `/conversations/${conversationId}`
        }, io).then(result => {
          if (result.success) {
            console.log(`✅ Notification stored successfully: ${result.notification.id}`);
          } else {
            console.error(`❌ Failed to store notification:`, result.error);
          }
        }).catch(error => {
          console.error(`❌ Error storing notification:`, error);
        });

        // Emit notification to receiver's personal room with context
        io.to(`user_${receiverId}`).emit("notification", {
          type: "message",
          data: {
            conversation_id: conversationId,
            message: newMessage,
            conversation_context: conversationContext,
            sender_id: senderId,
            receiver_id: receiverId,
            sender_name: senderName,
            title: `${senderName} sent you a message`,
            body: newMessage.message
          },
        });

        // Also emit to sender's personal room for confirmation
        io.to(`user_${senderId}`).emit("message_sent", {
          conversation_id: conversationId,
          message: newMessage,
          conversation_context: conversationContext,
        });

        // Compute conversation summary and emit conversations:upsert to both users
        try {
          const conversationListUtils = require('../utils/conversationListUpdates');

          // Fetch full conversation for updated_at and other fields
          const { data: fullConversation } = await supabaseAdmin
            .from('conversations')
            .select('*')
            .eq('id', conversationId)
            .single();

          const convData = fullConversation || {
            id: conversationId,
            chat_status: conversationContext?.chat_status,
            flow_state: conversationContext?.flow_state,
            awaiting_role: conversationContext?.awaiting_role,
            updated_at: new Date().toISOString()
          };

          // Build and emit for receiver
          const receiverPayload = await conversationListUtils.buildConversationsUpsertPayload({
            conversationId,
            currentUserId: receiverId,
            lastMessage: newMessage,
            conversation: convData
          });
          conversationListUtils.emitConversationsUpsert(io, receiverId, receiverPayload);

          // Build and emit for sender
          const senderPayload = await conversationListUtils.buildConversationsUpsertPayload({
            conversationId,
            currentUserId: senderId,
            lastMessage: newMessage,
            conversation: convData
          });
          conversationListUtils.emitConversationsUpsert(io, senderId, senderPayload);

          // Also emit unread_count_updated for receiver
          if (receiverPayload.unread_count > 0) {
            conversationListUtils.emitUnreadCountUpdated(
              io,
              receiverId,
              conversationId,
              receiverPayload.unread_count,
              'increment'
            );
          }
        } catch (e) {
          console.warn('conversations:upsert emit failed:', e.message);
        }
      } else {
      }

      // Send FCM push notification for REST API messages (only if user not viewing conversation)
      const fcmService = require('../services/fcmService');
      fcmService.sendMessageNotification(
        conversationId,
        newMessage,
        senderId,
        receiverId,
        io  // Pass io to check if user is in conversation room
      ).then(result => {
        if (result.success && !result.skipped) {
          console.log(`✅ FCM notification sent: ${result.sent} successful`);
        } else if (result.skipped) {
          console.log(`ℹ️ [FCM] Skipped - user is viewing conversation`);
        } else {
          console.error(`❌ FCM notification failed:`, result.error);
        }
      }).catch(error => { 
        console.error(`❌ FCM notification error:`, error);
      });

      // Emit conversation list update to both users
      if (io) {
        
        // Emit to individual user rooms
        io.to(`user_${senderId}`).emit('conversation_list_updated', {
          conversation_id: conversationId,
          message: newMessage,
          conversation_context: conversationContext,
          action: 'message_sent',
          timestamp: new Date().toISOString()
        });
        
        io.to(`user_${receiverId}`).emit('conversation_list_updated', {
          conversation_id: conversationId,
          message: newMessage,
          conversation_context: conversationContext,
          action: 'message_received',
          timestamp: new Date().toISOString()
        });

        // Emit to global update rooms
        io.to(`global_${senderId}`).emit('conversation_list_updated', {
          conversation_id: conversationId,
          message: newMessage,
          conversation_context: conversationContext,
          action: 'message_sent',
          timestamp: new Date().toISOString()
        });
        
        io.to(`global_${receiverId}`).emit('conversation_list_updated', {
          conversation_id: conversationId,
          message: newMessage,
          conversation_context: conversationContext,
          action: 'message_received',
          timestamp: new Date().toISOString()
        });

        // Emit unread count update to receiver
        io.to(`user_${receiverId}`).emit('unread_count_updated', {
          conversation_id: conversationId,
          unread_count: 1, // Increment by 1
          action: 'increment',
          timestamp: new Date().toISOString()
        });

        // Emit global unread count update
        io.to(`global_${receiverId}`).emit('unread_count_updated', {
          conversation_id: conversationId,
          unread_count: 1,
          action: 'increment',
          timestamp: new Date().toISOString()
        });

        // Emit typing status update
        io.to(`global_${senderId}`).emit('typing_status_update', {
          conversation_id: conversationId,
          user_id: senderId,
          is_typing: false,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: newMessage,
        conversation_id: conversationId,
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

      // Verify user is part of conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("id, brand_owner_id, influencer_id")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      if (
        conversation.brand_owner_id !== userId &&
        conversation.influencer_id !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Mark messages as seen
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

      // Emit socket events for real-time updates
      const io = req.app.get("io");
      if (io) {
        // Emit to conversation room
        io.to(`conversation_${conversation_id}`).emit('messages_seen', {
          conversationId: conversation_id,
          userId: userId,
          timestamp: new Date().toISOString()
        });

        // Emit to global update rooms
        io.to(`global_${userId}`).emit('messages_seen_update', {
          conversationId: conversation_id,
          timestamp: new Date().toISOString()
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

      // Get message and verify ownership
      const { data: message, error: msgError } = await supabaseAdmin
        .from("messages")
        .select("id, sender_id, conversation_id")
        .eq("id", message_id)
        .single();

      if (msgError || !message) {
        return res.status(404).json({
          success: false,
          message: "Message not found",
        });
      }

      if (message.sender_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Can only delete your own messages",
        });
      }

      // Delete message
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

      const { data: count, error } = await supabaseAdmin
        .from("messages")
        .select("id", { count: "exact" })
        .eq("receiver_id", userId)
        .eq("seen", false);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to get unread count",
        });
      }

      res.json({
        success: true,
        unread_count: count,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Direct connect functionality
   */
  async initiateDirectConnect(req, res) {
    try {
      const { target_user_id, initial_message } = req.body;
      const userId = req.user.id;

      if (!target_user_id) {
        return res.status(400).json({
          success: false,
          message: "target_user_id is required",
        });
      }

      if (target_user_id === userId) {
        return res.status(400).json({
          success: false,
          message: "Cannot connect to yourself",
        });
      }

      // Get user roles to determine conversation structure
      const { data: currentUser, error: currentUserError } = await supabaseAdmin
        .from("users")
        .select("id, role")
        .eq("id", userId)
        .single();

      const { data: targetUser, error: targetUserError } = await supabaseAdmin
        .from("users")
        .select("id, role")
        .eq("id", target_user_id)
        .single();

      if (currentUserError || targetUserError || !currentUser || !targetUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Determine brand_owner_id and influencer_id based on roles
      let brandOwnerId, influencerId;

      if (
        currentUser.role === "brand_owner" &&
        targetUser.role === "influencer"
      ) {
        brandOwnerId = userId;
        influencerId = target_user_id;
      } else if (
        currentUser.role === "influencer" &&
        targetUser.role === "brand_owner"
      ) {
        brandOwnerId = target_user_id;
        influencerId = userId;
      } else {
        // If both users have the same role or other combinations, use current user as brand_owner
        brandOwnerId = userId;
        influencerId = target_user_id;
      }

      // Check if direct connection already exists
      // Direct connections should be UNIQUE per user pair (one direct conversation per pair)
      const { data: existingConnection, error: existingError } =
        await supabaseAdmin
          .from("conversations")
          .select("id")
          .or(
            `and(brand_owner_id.eq.${brandOwnerId},influencer_id.eq.${influencerId}),and(brand_owner_id.eq.${influencerId},influencer_id.eq.${brandOwnerId})`
          )
          .is("campaign_id", null)
          .is("bid_id", null)
          .single();

      if (existingConnection) {
        // Return existing direct connection instead of error
        return res.status(200).json({
          success: true,
          conversation: existingConnection,
          conversation_id: existingConnection.id,
          message: "Direct connection already exists, returning existing conversation",
        });
      }

      // Create direct connection conversation
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .insert({
            brand_owner_id: brandOwnerId,
            influencer_id: influencerId,
            chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
            flow_state: "real_time", // FIXED: Use 'real_time' instead of 'direct_chat' to match database constraint
            awaiting_role: null,
            conversation_type: "direct"
          })
          .select()
          .single();

      if (conversationError) {
        console.error("Failed to create conversation:", conversationError);
        
        // If it's a duplicate key error, try to find the existing conversation
        if (conversationError.code === '23505') {
          console.log("Duplicate key error - looking for existing conversation");
          
          const { data: existingConv, error: findError } = await supabaseAdmin
            .from("conversations")
            .select("*")
            .or(
              `and(brand_owner_id.eq.${brandOwnerId},influencer_id.eq.${influencerId}),and(brand_owner_id.eq.${influencerId},influencer_id.eq.${brandOwnerId})`
            )
            .is("campaign_id", null)
            .is("bid_id", null)
            .single();
          
          if (existingConv) {
            return res.status(200).json({
              success: true,
              conversation: existingConv,
              conversation_id: existingConv.id,
              message: "Direct connection already exists, returning existing conversation",
            });
          }
        }
        
        return res.status(500).json({
          success: false,
          message: "Failed to create direct connection",
        });
      }

      // Create initial message if provided
      if (initial_message && conversation) {
        const { error: messageError } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id: conversation.id,
            sender_id: userId,
            receiver_id: target_user_id,
            message: initial_message,
          });

        if (messageError) {
          console.error("Failed to create initial message:", messageError);
          // Don't fail the conversation creation, just log the error
        }
      }

      // Emit WebSocket events for direct connection
      const io = req.app.get("io");
      if (io && conversation) {
        // Prepare conversation context
        const conversationContext = {
          id: conversation.id,
          chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
          flow_state: "real_time", // FIXED: Use 'real_time' instead of 'direct_chat' to match database constraint
          awaiting_role: null,
          conversation_type: "direct",
          automation_enabled: false,
          current_action_data: null
        };

        // Emit conversation state change event
        io.to(`conversation_${conversation.id}`).emit("conversation_state_changed", {
          conversation_id: conversation.id,
          previous_state: null, // New conversation
          new_state: {
            chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
            flow_state: "real_time", // FIXED: Use 'real_time' instead of 'direct_chat' to match database constraint
            awaiting_role: null
          },
          reason: "direct_connection_created",
          timestamp: new Date().toISOString()
        });

        // Emit conversation_updated event with context
        io.to(`conversation_${conversation.id}`).emit("conversation_updated", {
          conversation_id: conversation.id,
          flow_state: "real_time", // FIXED: Use 'real_time' instead of 'direct_chat' to match database constraint
          awaiting_role: null,
          chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
          conversation_type: "direct",
          conversation_context: conversationContext
        });

        // Store notifications in database and send to both users
        const notificationService = require('../services/notificationService');
        
        // Store notification for brand owner
        notificationService.storeNotification({
          user_id: brandOwnerId,
          type: 'direct_connection_created',
          title: 'Direct connection established',
          message: 'You have a new direct connection with an influencer',
          data: {
            conversation_id: conversation.id,
            chat_status: "real_time",
            conversation_context: conversationContext
          },
          action_url: `/conversations/${conversation.id}`
        }, io).then(result => {
          if (result.success) {
            console.log(`✅ Brand owner notification stored: ${result.notification.id}`);
          } else {
            console.error(`❌ Failed to store brand owner notification:`, result.error);
          }
        }).catch(error => {
          console.error(`❌ Error storing brand owner notification:`, error);
        });

        // Store notification for influencer
        notificationService.storeNotification({
          user_id: influencerId,
          type: 'direct_connection_created',
          title: 'Direct connection established',
          message: 'You have a new direct connection with a brand owner',
          data: {
            conversation_id: conversation.id,
            chat_status: "real_time",
            conversation_context: conversationContext
          },
          action_url: `/conversations/${conversation.id}`
        }, io).then(result => {
          if (result.success) {
            console.log(`✅ Influencer notification stored: ${result.notification.id}`);
          } else {
            console.error(`❌ Failed to store influencer notification:`, result.error);
          }
        }).catch(error => {
          console.error(`❌ Error storing influencer notification:`, error);
        });

        // Send individual notifications to both users with context
        io.to(`user_${brandOwnerId}`).emit("notification", {
          type: "direct_connection_created",
          data: {
            conversation_id: conversation.id,
            message: "Direct connection established",
            chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
            conversation_context: conversationContext
          }
        });

        io.to(`user_${influencerId}`).emit("notification", {
          type: "direct_connection_created", 
          data: {
            conversation_id: conversation.id,
            message: "Direct connection established",
            chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
            conversation_context: conversationContext
          }
        });
      }

      res.status(201).json({
        success: true,
        conversation: conversation,
        conversation_id: conversation.id,
        message: "Direct connection created successfully",
      });
    } catch (error) {
      console.error("Direct connect error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get direct connections
   */
  async getDirectConnections(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      const {
        data: conversations,
        error,
        count,
      } = await supabaseAdmin
        .from("conversations")
        .select("id, brand_owner_id, influencer_id, created_at, updated_at")
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`)
        .is("campaign_id", null)
        .is("bid_id", null)
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)
        .limit(limit);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch direct connections",
        });
      }

      // Get user details
      const userIds = new Set();
      conversations.forEach((conv) => {
        userIds.add(conv.brand_owner_id);
        userIds.add(conv.influencer_id);
      });

      const { data: users, error: usersError } = await supabaseAdmin
        .from("users")
        .select("id, name, role")
        .in("id", Array.from(userIds));

      if (usersError) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user details",
        });
      }

      const userMap = {};
      users.forEach((user) => {
        userMap[user.id] = user;
      });

      const enrichedConnections = conversations.map((conv) => {
        const otherUserId =
          conv.brand_owner_id === userId
            ? conv.influencer_id
            : conv.brand_owner_id;

        return {
          ...conv,
          other_user: userMap[otherUserId],
          is_brand_owner: conv.brand_owner_id === userId,
        };
      });

      res.json({
        success: true,
        connections: enrichedConnections,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
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
   * Send direct message
   */
  async sendDirectMessage(req, res) {
    try {
      const { conversation_id, message, media_url } = req.body;
      const senderId = req.user.id;

      // Verify conversation exists and user is part of it
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("id, brand_owner_id, influencer_id")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      if (
        conversation.brand_owner_id !== senderId &&
        conversation.influencer_id !== senderId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Determine receiver ID
      const receiverId =
        conversation.brand_owner_id === senderId
          ? conversation.influencer_id
          : conversation.brand_owner_id;

      // Create message
      const { data: newMessage, error } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id,
          sender_id: senderId,
          receiver_id: receiverId,
          message,
          media_url,
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to send message",
        });
      }

      // Update conversation timestamp
      await supabaseAdmin
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversation_id);

      // Emit real-time message via Socket.IO if available
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation_${conversation_id}`).emit("new_message", {
          message: newMessage,
          conversationId: conversation_id,
        });
      }

      res.status(201).json({
        success: true,
        message: newMessage,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get conversation context for frontend rendering
   */
  async getConversationContext(req, res) {
    try {
      const { conversation_id } = req.params;
      const userId = req.user.id;

      // Get conversation with source data
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(
          `
          *,
          campaigns (
            id, title, description, budget, requirements, deliverables, 
            campaign_type, platform, content_type, status
          ),
          bids (
            id, title, description, min_budget, max_budget, requirements, 
            language, platform, content_type, category, status
          )
        `
        )
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Verify user is part of conversation
      if (
        conversation.brand_owner_id !== userId &&
        conversation.influencer_id !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Get user details
      const { data: users, error: usersError } = await supabaseAdmin
        .from("users")
        .select("id, name, role")
        .in("id", [conversation.brand_owner_id, conversation.influencer_id]);

      if (usersError) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user details",
        });
      }

      const userMap = {};
      users.forEach((user) => (userMap[user.id] = user));

      const currentUser = userMap[userId];
      const otherUser =
        conversation.brand_owner_id === userId
          ? userMap[conversation.influencer_id]
          : userMap[conversation.brand_owner_id];

      // Determine source type and data
      let sourceType = null;
      let sourceData = null;
      let contextTitle = "";
      let contextSubtitle = "";

      if (conversation.campaign_id && conversation.campaigns) {
        sourceType = "campaign";
        sourceData = conversation.campaigns;
        contextTitle = "Campaign Application";
        contextSubtitle = `${otherUser.name} has applied to your campaign`;
      } else if (conversation.bid_id && conversation.bids) {
        sourceType = "bid";
        sourceData = conversation.bids;
        contextTitle = "Bid Application";
        contextSubtitle = `${otherUser.name} has applied to your bid`;
      } else {
        sourceType = "direct";
        contextTitle = "Direct Connection";
        contextSubtitle = `Direct conversation with ${otherUser.name}`;
      }

      // Get last message for context
      const { data: lastMessage } = await supabaseAdmin
        .from("messages")
        .select("message, sender_id, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // Determine available actions based on user role and conversation state
      let availableActions = [];
      let canAct = false;
      let awaitingRole = null;

      if (currentUser.role === "brand_owner") {
        if (sourceType === "campaign" || sourceType === "bid") {
          // Brand owner can act on applications
          canAct = true;
          availableActions = [
            {
              id: "accept_offer",
              text: "Accept Offer",
              style: "success",
              description: "Accept the influencer's proposal",
            },
            {
              id: "negotiate_price",
              text: "Negotiate Price",
              style: "warning",
              description: "Start price negotiation",
            },
            {
              id: "ask_specific_question",
              text: "Ask Question",
              style: "info",
              description: "Ask a specific question",
            },
            {
              id: "decline_offer",
              text: "Decline",
              style: "danger",
              description: "Decline the offer",
            },
          ];
        }
      } else if (currentUser.role === "influencer") {
        if (sourceType === "campaign" || sourceType === "bid") {
          // Influencer can respond to brand owner actions
          canAct = false; // Initially false, depends on brand owner's action
          availableActions = [
            {
              id: "confirm_collaboration",
              text: "Confirm",
              style: "success",
              description: "Confirm collaboration after acceptance",
            },
            {
              id: "decline_collaboration",
              text: "Decline",
              style: "danger",
              description: "Decline collaboration after acceptance",
            },
          ];
        }
      }

      // Build context object
      const context = {
        conversation: {
          id: conversation.id,
          chat_status: conversation.chat_status,
          flow_state: conversation.flow_state,
          awaiting_role: conversation.awaiting_role,
          current_action_data: conversation.current_action_data,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
        },
        source: {
          type: sourceType,
          data: sourceData,
        },
        users: {
          current: {
            id: currentUser.id,
            name: currentUser.name,
            role: currentUser.role,
          },
          other: {
            id: otherUser.id,
            name: otherUser.name,
            role: otherUser.role,
          },
        },
        prompts: {
          title: contextTitle,
          subtitle: contextSubtitle,
          details: sourceData
            ? [
                sourceData.title,
                sourceData.description,
                sourceType === "campaign"
                  ? `Budget: ₹${sourceData.budget}`
                  : `Budget: ₹${sourceData.min_budget} - ₹${sourceData.max_budget}`,
                sourceData.requirements,
              ].filter(Boolean)
            : [],
          actions: availableActions,
        },
        state: {
          can_act: canAct,
          awaiting_role: awaitingRole,
          last_message: lastMessage,
        },
      };

      res.json({
        success: true,
        context,
      });
    } catch (error) {
      console.error("Get conversation context error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle button clicks from frontend
   */
  async handleButtonClick(req, res) {
    try {
      const { conversation_id } = req.params;
      const { button_id, additional_data, data } = req.body;
      const userId = req.user.id;
      
      // Handle both data formats from frontend (data or additional_data)
      const buttonData = additional_data || data || {};

      // Get conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select(
          `
          *,
          campaigns (id, title, budget),
          bids (id, title, min_budget, max_budget)
        `
        )
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Get user details first to check admin role
      const { data: currentUser, error: userError } = await supabaseAdmin
        .from("users")
        .select("id, name, role")
        .eq("id", userId)
        .single();

      if (userError) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user details",
        });
      }

      // Check if user is admin
      const isAdmin = currentUser?.role === 'admin';

      // Verify user is part of conversation OR is admin
      if (
        conversation.brand_owner_id !== userId &&
        conversation.influencer_id !== userId &&
        !isAdmin
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Check if this is an automated flow conversation
      // Handle automated flow actions (including work submission from real_time chat)
      if (conversation.flow_state) {
        // Route to appropriate automated flow handler
        const automatedFlowService = require('../utils/automatedFlowService');
        const adminPaymentFlowService = require('../utils/adminPaymentFlowService');
        
        try {
          let result;
          
          // Handle admin payment actions
          if (isAdmin && (button_id === 'process_advance_payment' || button_id === 'process_final_payment')) {
            // Get admin payment tracking ID from button data or conversation flow_data
            const adminPaymentTrackingId = buttonData?.admin_payment_tracking_id || 
                                          conversation.flow_data?.admin_payment_tracking_id;
            
            if (!adminPaymentTrackingId) {
              return res.status(400).json({
                success: false,
                message: "Admin payment tracking ID not found"
              });
            }

            if (button_id === 'process_advance_payment') {
              // Process advance payment
              const screenshotUrl = buttonData?.screenshot_url || null;
              result = await adminPaymentFlowService.confirmAdvancePayment(
                adminPaymentTrackingId,
                screenshotUrl
              );
              
              if (result.success) {
                // Update conversation state to work_in_progress
                await supabaseAdmin
                  .from("conversations")
                  .update({
                    flow_state: "work_in_progress",
                    awaiting_role: "influencer",
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", conversation_id);
              }
            } else if (button_id === 'process_final_payment') {
              // Process final payment
              const screenshotUrl = buttonData?.screenshot_url || null;
              result = await adminPaymentFlowService.processFinalPayment(
                adminPaymentTrackingId,
                screenshotUrl
              );
              
              if (result.success) {
                // Update conversation state to closed
                await supabaseAdmin
                  .from("conversations")
                  .update({
                    flow_state: "chat_closed",
                    chat_status: "closed",
                    awaiting_role: null,
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", conversation_id);
              }
            }
            
            if (result && result.success) {
              return res.json(result);
            } else {
              return res.status(400).json({
                success: false,
                message: result?.error || "Failed to process admin payment"
              });
            }
          }
          
          if (userId === conversation.brand_owner_id) {
            // Map button IDs to automated flow actions
            let action = button_id;
            let data = {};
            
            // Handle special button mappings
            
            if (button_id === 'agree_negotiation') {
              action = 'handle_negotiation';
              data = { action: 'agree' };
            } else if (button_id === 'reject_negotiation') {
              action = 'handle_negotiation';
              data = { action: 'reject' };
            } else if (button_id === 'send_negotiated_price') {
              action = 'send_negotiated_price';
              data = { price: additional_data?.price };
            } else if (button_id === 'send_project_details') {
              action = 'send_project_details';
              data = { details: additional_data?.details };
            } else if (button_id === 'send_price_offer') {
              action = 'send_price_offer';
              data = { price: additional_data?.price };
            } else if (button_id === 'proceed_to_payment') {
              action = 'proceed_to_payment';
              data = additional_data || {};
            } else if (button_id === 'accept_counter_offer') {
              action = 'accept_counter_offer';
              data = additional_data || {};
            } else if (button_id === 'reject_counter_offer') {
              action = 'reject_counter_offer';
              data = { price: additional_data?.price };
            } else if (button_id === 'make_final_offer') {
              action = 'make_final_offer';
              data = additional_data || {};
            } else if (button_id === 'approve_work') {
              action = 'approve_work';
              data = additional_data || {};
            } else if (button_id === 'request_revision') {
              action = 'request_revision';
              data = additional_data || {};
            } else if (button_id === 'reject_final_work') {
              action = 'reject_final_work';
              data = additional_data || {};
            } else {
              // Use additional_data for unmapped buttons
              data = additional_data || {};
            }
            
            result = await automatedFlowService.handleBrandOwnerAction(conversation_id, action, data);
          } else if (currentUser.role === 'influencer' || userId === conversation.influencer_id) {
            // Map button IDs to automated flow actions for influencers
            let action = button_id;
            let data = {};
            
            // Handle special button mappings for influencers
            
            if (button_id === 'accept_offer') {
              action = 'accept_offer';
            } else if (button_id === 'reject_offer') {
              action = 'reject_offer';
            } else if (button_id === 'negotiate_price') {
              action = 'negotiate_price';
            } else if (button_id === 'accept_negotiated_price') {
              action = 'accept_negotiated_price';
            } else if (button_id === 'reject_negotiated_price') {
              action = 'reject_negotiated_price';
            } else if (button_id === 'continue_negotiate') {
              action = 'continue_negotiate';
            } else if (button_id === 'send_counter_offer') {
              action = 'send_counter_offer';
              data = { price: buttonData?.price };
            } else if (button_id === 'accept_final_offer') {
              action = 'accept_final_offer';
              data = buttonData || {};
            } else if (button_id === 'reject_final_offer') {
              action = 'reject_final_offer';
              data = buttonData || {};
            } else if (button_id === 'submit_work') {
              action = 'submit_work';
              data = buttonData || {};
            } else if (button_id === 'resubmit_work') {
              action = 'resubmit_work';
              data = buttonData || {};
            } else {
              // Use buttonData for unmapped buttons
              data = buttonData || {};
            }
            
            result = await automatedFlowService.handleInfluencerAction(conversation_id, action, data);
          }
          
          if (result && result.success) {
            return res.json(result);
          } else {
            return res.status(400).json({
              success: false,
              message: "Failed to handle button click",
              error: result?.error || "Unknown error"
            });
          }
        } catch (automatedError) {
          // Fall through to old handler as backup
        }
      }

      // Handle button actions based on role and button ID
      let message = "";
      let receiverId = null;
      let flowUpdate = {};

      if (currentUser.role === "brand_owner") {
        receiverId = conversation.influencer_id;

        switch (button_id) {
          case "accept_offer":
            message = `I accept your proposal! Let's proceed with the collaboration.`;
            flowUpdate = {
              chat_status: "accepted",
              payment_required: true,
            };
            break;

          case "negotiate_price":
            message = `I'd like to negotiate the price. What's your best offer?`;
            flowUpdate = {
              chat_status: "negotiating",
              awaiting_role: "influencer",
            };
            break;

          case "ask_specific_question":
            const question =
              additional_data?.question ||
              "I have a question about the requirements.";
            message = `I have a question: ${question}`;
            flowUpdate = {
              chat_status: "question_pending",
              awaiting_role: "influencer",
            };
            break;

          case "decline_offer":
            message = `Thank you for your interest, but I'll pass on this opportunity.`;
            flowUpdate = {
              chat_status: "declined",
              awaiting_role: null,
            };
            break;

          default:
            return res.status(400).json({
              success: false,
              message: "Invalid button action",
            });
        }
      } else if (currentUser.role === "influencer") {
        receiverId = conversation.brand_owner_id;

        switch (button_id) {
          case "confirm_collaboration":
            message = `Yes, I'm excited to work on this project! Let's get started.`;
            flowUpdate = {
              chat_status: "confirmed",
              payment_required: true,
            };
            break;

          case "decline_collaboration":
            message = `Thank you for the opportunity, but I'll have to decline.`;
            flowUpdate = {
              chat_status: "declined",
              awaiting_role: null,
            };
            break;

          case "accept_offer":
            message = `I accept your offer! Let's proceed.`;
            flowUpdate = {
              chat_status: "accepted",
              payment_required: true,
            };
            break;

          case "counter_offer":
            const counterAmount =
              additional_data?.amount || "a different amount";
            message = `I can do it for ₹${counterAmount} instead.`;
            flowUpdate = {
              chat_status: "negotiating",
              awaiting_role: "brand_owner",
            };
            break;

          case "decline_offer":
            message = `Thank you for the offer, but I'll have to decline.`;
            flowUpdate = {
              chat_status: "declined",
              awaiting_role: null,
            };
            break;

          case "respond_to_question":
            const response =
              additional_data?.response || "Here's my answer to your question.";
            message = `Here's my answer: ${response}`;
            flowUpdate = {
              chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
              awaiting_role: "brand_owner",
            };
            break;

          default:
            return res.status(400).json({
              success: false,
              message: "Invalid button action",
            });
        }
      }

      // Create automated message
      const { data: newMessage, error: msgError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id,
          sender_id: userId,
          receiver_id: receiverId,
          message,
          message_type: "automated",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (msgError) {
        return res.status(500).json({
          success: false,
          message: "Failed to create message",
        });
      }

      // Update conversation flow state
      if (Object.keys(flowUpdate).length > 0) {
        const { error: updateError } = await supabaseAdmin
          .from("conversations")
          .update({
            ...flowUpdate,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversation_id);

        if (updateError) {
          console.error("Failed to update conversation flow:", updateError);
        }
      }

      // Emit real-time update
      const io = req.app.get("io");
      if (io) {
        // Get updated conversation context after flow update
        const { data: updatedConversation, error: convError } = await supabaseAdmin
          .from("conversations")
          .select("id, chat_status, flow_state, awaiting_role, campaign_id, bid_id, current_action_data")
          .eq("id", conversation_id)
          .single();

        const conversationContext = updatedConversation ? {
          id: updatedConversation.id,
          chat_status: updatedConversation.chat_status,
          flow_state: updatedConversation.flow_state,
          awaiting_role: updatedConversation.awaiting_role,
          conversation_type: updatedConversation.campaign_id ? 'campaign' : 
                            updatedConversation.bid_id ? 'bid' : 'direct',
          
          current_action_data: updatedConversation.current_action_data
        } : null;

        io.to(`conversation_${conversation_id}`).emit("button_action", {
          button_id,
          message: newMessage,
          flow_update: flowUpdate,
          conversationId: conversation_id,
          conversation_context: conversationContext,
        });

        // Also emit standard new_message for clients that only listen to new_message
        io.to(`conversation_${conversation_id}`).emit("new_message", {
          conversation_id,
          message: newMessage,
          conversation_context: conversationContext,
        });

        // Emit notification to the receiver
        const receiverId = conversation.brand_owner_id === userId
          ? conversation.influencer_id
          : conversation.brand_owner_id;

        io.to(`user_${receiverId}`).emit("notification", {
          type: "message",
          data: {
            id: newMessage.id,
            title: "New message",
            body: newMessage.message,
            created_at: newMessage.created_at,
            conversation_context: conversationContext,
            payload: { conversation_id, message_id: newMessage.id, sender_id: userId },
            conversation_id,
            message: newMessage,
            sender_id: userId,
            receiver_id: receiverId,
          },
        });
      }

      res.json({
        success: true,
        message: newMessage,
        flow_update: flowUpdate,
      });
    } catch (error) {
      console.error("Button click error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  } 
  async handleTextInput(req, res) {
    try {
      const { conversation_id } = req.params;
      const { text, input_type } = req.body;
      const userId = req.user.id;

      // Get conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Verify user is part of conversation
      if (
        conversation.brand_owner_id !== userId &&
        conversation.influencer_id !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Get user details
      const { data: currentUser, error: userError } = await supabaseAdmin
        .from("users")
        .select("id, name, role")
        .eq("id", userId)
        .single();

      if (userError) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user details",
        });
      }

      const receiverId =
        conversation.brand_owner_id === userId
          ? conversation.influencer_id
          : conversation.brand_owner_id;

      // Handle different input types
      let message = "";
      let flowUpdate = {};

      switch (input_type) {
        case "negotiation":
          message = `I propose ₹${text} for this collaboration.`;
          flowUpdate = {
            chat_status: "negotiating",
            awaiting_role:
              currentUser.role === "brand_owner" ? "influencer" : "brand_owner",
          };
          break;

        case "question":
          message = `My question: ${text}`;
          flowUpdate = {
            chat_status: "question_pending",
            awaiting_role: "influencer",
          };
          break;

        case "response":
          message = `My response: ${text}`;
          flowUpdate = {
            chat_status: "real_time", // FIXED: Use 'real_time' to match database constraint
            awaiting_role:
              currentUser.role === "brand_owner" ? "influencer" : "brand_owner",
          };
          break;

        case "general":
        default:
          message = text;
          break;
      }

      // Create message
      const { data: newMessage, error: msgError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id,
          sender_id: userId,
          receiver_id: receiverId,
          message,
          message_type: "user_input",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (msgError) {
        return res.status(500).json({
          success: false,
          message: "Failed to create message",
        });
      }

      // Update conversation flow state if needed
      if (Object.keys(flowUpdate).length > 0) {
        const { error: updateError } = await supabaseAdmin
          .from("conversations")
          .update({
            ...flowUpdate,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversation_id);

        if (updateError) {
          console.error("Failed to update conversation flow:", updateError);
        }
      }

      // Emit real-time update
      const io = req.app.get("io");
      if (io) {
        io.to(`conversation_${conversation_id}`).emit("text_input", {
          input_type,
          message: newMessage,
          flow_update: flowUpdate,
          conversationId: conversation_id,
        });
      }

      res.json({
        success: true,
        message: newMessage,
        flow_update: flowUpdate,
      });
    } catch (error) {
      console.error("Text input error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get direct conversations (not related to campaigns/bids)
   */
  async getDirectConversations(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      console.log(`🔍 Fetching direct conversations for user: ${userId}`);

      // Get direct conversations only (no campaign or bid)
      const {
        data: conversations,
        error,
        count,
      } = await supabaseAdmin
        .from("conversations")
        .select(
          "id, brand_owner_id, influencer_id, chat_status, created_at, updated_at"
        )
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`)
        .is("campaign_id", null)
        .is("bid_id", null)
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)
        .limit(limit);

      if (error) {
        console.error(
          "❌ Database error fetching direct conversations:",
          error
        );
        return res.status(500).json({
          success: false,
          message: "Failed to fetch direct conversations",
        });
      }

      console.log(
        `📊 Found ${conversations?.length || 0} direct conversations`
      );

      // Handle case where no direct conversations exist
      if (!conversations || conversations.length === 0) {
        return res.json({
          success: true,
          conversations: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
          },
          message: "No direct conversations found",
        });
      }

      // Get user details for conversations
      const userIds = new Set();
      conversations.forEach((conv) => {
        if (conv.brand_owner_id) userIds.add(conv.brand_owner_id);
        if (conv.influencer_id) userIds.add(conv.influencer_id);
      });

      let userMap = {};

      // Only fetch user details if there are conversations
      if (userIds.size > 0) {
        const { data: users, error: usersError } = await supabaseAdmin
          .from("users")
          .select("id, name, role, profile_image_url")
          .in("id", Array.from(userIds));

        if (usersError) {
          console.error("❌ Error fetching user details:", usersError);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch user details",
          });
        }

        users.forEach((user) => {
          userMap[user.id] = user;
        });
      }

      // Enrich conversations with user details and last message
      const enrichedConversations = await Promise.all(
        conversations.map(async (conv) => {
          try {
            // Get last message
            const { data: lastMessage } = await supabaseAdmin
              .from("messages")
              .select("message, created_at, sender_id")
              .eq("conversation_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .single();

            const otherUserId =
              conv.brand_owner_id === userId
                ? conv.influencer_id
                : conv.brand_owner_id;

            const otherUser = userMap[otherUserId];

            return {
              ...conv,
              other_user: otherUser || {
                id: otherUserId,
                name: "Unknown User",
                role: "unknown",
              },
              last_message: lastMessage || null,
              is_brand_owner: conv.brand_owner_id === userId,
              conversation_type: "direct",
              conversation_title: "Direct Chat",
            };
          } catch (error) {
            console.error(
              `❌ Error enriching direct conversation ${conv.id}:`,
              error
            );
            return {
              ...conv,
              other_user: {
                id: "unknown",
                name: "Error Loading User",
                role: "unknown",
              },
              last_message: null,
              is_brand_owner: conv.brand_owner_id === userId,
              conversation_type: "direct",
              conversation_title: "Direct Chat",
            };
          }
        })
      );

      res.json({
        success: true,
        conversations: enrichedConversations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
        },
        conversation_type: "direct",
      });
    } catch (error) {
      console.error("💥 Unexpected error in getDirectConversations:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Check if conversation exists by bid_id, campaign_id, or user_id
   * Used by frontend to build conversation index for button state management
   */
  async checkConversationExists(req, res) {
    try {
      const userId = req.user.id;
      const { bid_id, campaign_id, user_id } = req.query;

      if (!bid_id && !campaign_id && !user_id) {
        return res.status(400).json({
          success: false,
          message: "At least one of bid_id, campaign_id, or user_id is required",
        });
      }

      let query = supabaseAdmin
        .from("conversations")
        .select("id, bid_id, campaign_id, brand_owner_id, influencer_id")
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`); // User must be part of conversation

      // Add filters based on provided parameters
      if (bid_id) {
        query = query.eq("bid_id", bid_id);
      }
      if (campaign_id) {
        query = query.eq("campaign_id", campaign_id);
      }
      if (user_id) {
        // For direct messages, check if conversation exists between current user and target user
        query = query.or(`brand_owner_id.eq.${user_id},influencer_id.eq.${user_id}`)
                     .is("campaign_id", null)
                     .is("bid_id", null);
      }

      const { data: conversation, error } = await query.maybeSingle();

      if (error) {
        console.error("❌ Error checking conversation existence:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to check conversation",
        });
      }

      return res.json({
        success: true,
        exists: !!conversation,
        conversation_id: conversation?.id || null,
        conversation: conversation || null,
      });
    } catch (error) {
      console.error("❌ Error in checkConversationExists:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get conversation index - returns all conversation mappings for a user
   * Used by frontend to build persistent conversation index
   */
  async getConversationIndex(req, res) {
    try {
      const userId = req.user.id;
      const { limit = 1000 } = req.query; // Large limit to get all conversations

      console.log(`🔍 Building conversation index for user: ${userId}`);

      // Get all conversations for this user
      const { data: conversations, error } = await supabaseAdmin
        .from("conversations")
        .select("id, bid_id, campaign_id, brand_owner_id, influencer_id")
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`)
        .order("updated_at", { ascending: false })
        .limit(parseInt(limit));

      if (error) {
        console.error("❌ Error fetching conversations for index:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch conversations",
        });
      }

      // Build index structure
      const index = {
        bids: {},
        campaigns: {},
        direct: {},
        lastUpdated: Date.now(),
      };

      conversations?.forEach((conv) => {
        if (conv.bid_id) {
          index.bids[conv.bid_id] = conv.id;
        }
        if (conv.campaign_id) {
          index.campaigns[conv.campaign_id] = conv.id;
        }
        if (!conv.bid_id && !conv.campaign_id) {
          // Direct conversation - map by other user's ID
          const otherUserId = conv.brand_owner_id === userId 
            ? conv.influencer_id 
            : conv.brand_owner_id;
          if (otherUserId) {
            index.direct[otherUserId] = conv.id;
          }
        }
      });

      console.log(`✅ Built conversation index: ${Object.keys(index.bids).length} bids, ${Object.keys(index.campaigns).length} campaigns, ${Object.keys(index.direct).length} direct`);

      return res.json({
        success: true,
        index,
        total: conversations?.length || 0,
      });
    } catch (error) {
      console.error("❌ Error in getConversationIndex:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get bid conversations for a user based on their role
   */
  async getBidConversations(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      console.log(
        `🔍 Fetching bid conversations for user: ${userId}, role: ${userRole}`
      );

      // SECURITY: Always filter by userId - user must be either brand_owner or influencer in the conversation
      // Get bid conversations only (must have bid_id)
      let query = supabaseAdmin
        .from("conversations")
        .select(
          `
          id, brand_owner_id, influencer_id, bid_id, chat_status, 
          created_at, updated_at, flow_state, awaiting_role,
          bids!inner(
            id, title, description, min_budget, max_budget, status, requirements,
            language, platform, content_type, category
          )
        `
        )
        .not("bid_id", "is", null)
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`) // CRITICAL: Always filter by userId
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)
        .limit(limit);

      const { data: conversations, error, count } = await query;

      if (error) {
        console.error("❌ Database error fetching bid conversations:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch bid conversations",
        });
      }

      console.log(`📊 Found ${conversations?.length || 0} bid conversations`);

      // Handle case where no bid conversations exist
      if (!conversations || conversations.length === 0) {
        return res.json({
          success: true,
          conversations: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
          },
          message: "No bid conversations found",
        });
      }

      // Get user details for conversations
      const userIds = new Set();
      conversations.forEach((conv) => {
        if (conv.brand_owner_id) userIds.add(conv.brand_owner_id);
        if (conv.influencer_id) userIds.add(conv.influencer_id);
      });

      let userMap = {};

      // Only fetch user details if there are conversations
      if (userIds.size > 0) {
        const { data: users, error: usersError } = await supabaseAdmin
          .from("users")
          .select("id, name, role, profile_image_url")
          .in("id", Array.from(userIds));

        if (usersError) {
          console.error("❌ Error fetching user details:", usersError);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch user details",
          });
        }

        users.forEach((user) => {
          userMap[user.id] = user;
        });
      }

      // Enrich conversations with user details and last message
      const enrichedConversations = await Promise.all(
        conversations.map(async (conv) => {
          try {
            // Get last message
            const { data: lastMessage } = await supabaseAdmin
              .from("messages")
              .select("message, created_at, sender_id")
              .eq("conversation_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .single();

            const otherUserId =
              conv.brand_owner_id === userId
                ? conv.influencer_id
                : conv.brand_owner_id;

            const otherUser = userMap[otherUserId];

            return {
              id: conv.id,
              bid_id: conv.bid_id,
              created_at: conv.created_at,
              updated_at: conv.updated_at,
              chat_status: conv.chat_status,
              flow_state: conv.flow_state,
              awaiting_role: conv.awaiting_role,
              is_brand_owner: conv.brand_owner_id === userId,
              bid: conv.bids,
              other_user: otherUser || {
                id: otherUserId,
                name: "Unknown User",
                role: "unknown",
              },
              last_message: lastMessage || null,
              conversation_type: "bid",
              conversation_title: conv.bids?.title || "Bid Application",
            };
          } catch (error) {
            console.error(
              `❌ Error enriching bid conversation ${conv.id}:`,
              error
            );
            return {
              id: conv.id,
              bid_id: conv.bid_id,
              created_at: conv.created_at,
              updated_at: conv.updated_at,
              chat_status: conv.chat_status,
              flow_state: conv.flow_state,
              awaiting_role: conv.awaiting_role,
              is_brand_owner: conv.brand_owner_id === userId,
              bid: conv.bids,
              other_user: {
                id: "unknown",
                name: "Error Loading User",
                role: "unknown",
              },
              last_message: null,
              conversation_type: "bid",
              conversation_title: "Bid Application",
            };
          }
        })
      );

      res.json({
        success: true,
        conversations: enrichedConversations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
        },
        conversation_type: "bid",
        message: `Found ${enrichedConversations.length} bid conversations`,
      });
    } catch (error) {
      console.error("💥 Unexpected error in getBidConversations:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get campaign conversations for a user based on their role
   */
  async getCampaignConversations(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      console.log(
        `🔍 Fetching campaign conversations for user: ${userId}, role: ${userRole}`
      );

      // SECURITY: Always filter by userId - user must be either brand_owner or influencer in the conversation
      // Get campaign conversations only (must have campaign_id, no bid_id)
      let query = supabaseAdmin
        .from("conversations")
        .select(
          `
          id, brand_owner_id, influencer_id, campaign_id, chat_status, 
          created_at, updated_at, flow_state, awaiting_role,
          campaigns!inner(
            id, title, description, min_budget, max_budget, status, requirements,
            language, platform, content_type, category, campaign_type, deliverables
          )
        `
        )
        .not("campaign_id", "is", null)
        .is("bid_id", null) // No bid associated
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`) // CRITICAL: Always filter by userId
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)
        .limit(limit);

      const { data: conversations, error, count } = await query;

      if (error) {
        console.error(
          "❌ Database error fetching campaign conversations:",
          error
        );
        return res.status(500).json({
          success: false,
          message: "Failed to fetch campaign conversations",
        });
      }

      console.log(
        `📊 Found ${conversations?.length || 0} campaign conversations`
      );

      // Handle case where no campaign conversations exist
      if (!conversations || conversations.length === 0) {
        return res.json({
          success: true,
          conversations: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
          },
          message: "No campaign conversations found",
        });
      }

      // Get user details for conversations
      const userIds = new Set();
      conversations.forEach((conv) => {
        if (conv.brand_owner_id) userIds.add(conv.brand_owner_id);
        if (conv.influencer_id) userIds.add(conv.influencer_id);
      });

      let userMap = {};

      // Only fetch user details if there are conversations
      if (userIds.size > 0) {
        const { data: users, error: usersError } = await supabaseAdmin
          .from("users")
          .select("id, name, role, profile_image_url")
          .in("id", Array.from(userIds));

        if (usersError) {
          console.error("❌ Error fetching user details:", usersError);
          return res.status(500).json({
            success: false,
            message: "Failed to fetch user details",
          });
        }

        users.forEach((user) => {
          userMap[user.id] = user;
        });
      }

      // Enrich conversations with user details and last message
      const enrichedConversations = await Promise.all(
        conversations.map(async (conv) => {
          try {
            // Get last message
            const { data: lastMessage } = await supabaseAdmin
              .from("messages")
              .select("message, created_at, sender_id")
              .eq("conversation_id", conv.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .single();

            const otherUserId =
              conv.brand_owner_id === userId
                ? conv.influencer_id
                : conv.brand_owner_id;

            const otherUser = userMap[otherUserId];

            return {
              id: conv.id,
              campaign_id: conv.campaign_id,
              created_at: conv.created_at,
              updated_at: conv.updated_at,
              chat_status: conv.chat_status,
              flow_state: conv.flow_state,
              awaiting_role: conv.awaiting_role,
              is_brand_owner: conv.brand_owner_id === userId,
              campaign: conv.campaigns,
              other_user: otherUser || {
                id: otherUserId,
                name: "Unknown User",
                role: "unknown",
              },
              last_message: lastMessage || null,
              conversation_type: "campaign",
              conversation_title:
                conv.campaigns?.title || "Campaign Application",
            };
          } catch (error) {
            console.error(
              `❌ Error enriching campaign conversation ${conv.id}:`,
              error
            );
            return {
              id: conv.id,
              campaign_id: conv.campaign_id,
              created_at: conv.created_at,
              updated_at: conv.updated_at,
              chat_status: conv.chat_status,
              flow_state: conv.flow_state,
              awaiting_role: conv.awaiting_role,
              is_brand_owner: conv.brand_owner_id === userId,
              campaign: conv.campaigns,
              other_user: {
                id: "unknown",
                name: "Error Loading User",
                role: "unknown",
              },
              last_message: null,
              conversation_type: "campaign",
              conversation_title: "Campaign Application",
            };
          }
        })
      );

      res.json({
        success: true,
        conversations: enrichedConversations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
        },
        conversation_type: "campaign",
        message: `Found ${enrichedConversations.length} campaign conversations`,
      });
    } catch (error) {
      console.error("💥 Unexpected error in getCampaignConversations:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
}

// Validation middleware
const validateSendMessage = [
  // Either conversation_id OR receiver_id is required
  body()
    .custom((value, { req }) => {
      const { conversation_id, receiver_id } = req.body;

      // For existing conversations
      if (conversation_id) {
        if (
          typeof conversation_id !== "string" ||
          conversation_id.length === 0
        ) {
          throw new Error("Conversation ID must be a valid string");
        }
        return true;
      }

      // For new conversations
      if (receiver_id) {
        if (typeof receiver_id !== "string" || receiver_id.length === 0) {
          throw new Error("Receiver ID must be a valid string");
        }
        return true;
      }

      // Neither provided
      throw new Error(
        "Either conversation_id (for existing conversations) or receiver_id (for new conversations) is required"
      );
    })
    .withMessage(
      "Invalid request: must provide either conversation_id or receiver_id"
    ),

  body("message")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage("Message must be between 1 and 1000 characters"),

  body("media_url")
    .optional()
    .isURL()
    .withMessage("Media URL must be a valid URL"),

  // Custom validation: either message or media_url must be provided
  body()
    .custom((value, { req }) => {
      const { message, media_url } = req.body;
      
      if (!message && !media_url) {
        throw new Error("Either message or media_url must be provided");
      }
      
      return true;
    })
    .withMessage("Either message or media_url must be provided"),

  // Optional fields for new conversations
  body("campaign_id")
    .optional()
    .isUUID()
    .withMessage("Campaign ID must be a valid UUID"),

  body("bid_id").optional().isUUID().withMessage("Bid ID must be a valid UUID"),
];

module.exports = {
  MessageController: new MessageController(),
  validateSendMessage,
};
