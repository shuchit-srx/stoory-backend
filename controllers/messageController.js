const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult } = require("express-validator");

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
        .single();

      if (userError) {
        console.error("❌ Error fetching user role:", userError);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user details",
        });
      }

      console.log(`👤 User role: ${currentUser.role}`);

      let conversationsQuery;
      let queryDescription;

      if (currentUser.role === "brand_owner") {
        // Brand owners see conversations related to THEIR campaigns and bids
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
          .eq("brand_owner_id", userId) // Only conversations where they are the brand owner
          .or("campaign_id.not.is.null,bid_id.not.is.null"); // Must have either campaign OR bid

        queryDescription = "Brand owner campaigns and bids";
      } else if (currentUser.role === "influencer") {
        // Influencers see conversations related to campaigns/bids they applied to
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
          .eq("influencer_id", userId) // Only conversations where they are the influencer
          .or("campaign_id.not.is.null,bid_id.not.is.null"); // Must have either campaign OR bid

        queryDescription = "Influencer applications to campaigns/bids";
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
      const {
        data: conversations,
        error,
        count,
      } = await conversationsQuery
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)
        .limit(limit);

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
          .select("id, name, role")
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
          total: count || 0,
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
            chat_status: "realtime",
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
      if (io) {
        io.to(conversationId).emit("new_message", {
          conversation_id: conversationId,
          message: newMessage,
        });
      }

      console.log(
        `✅ Message sent successfully in conversation: ${conversationId}`
      );

      res.json({
        success: true,
        message: newMessage,
        conversation_id: conversationId,
      });
    } catch (error) {
      console.error("💥 Unexpected error in sendMessage:", error);
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
      const { target_user_id } = req.body;
      const userId = req.user.id;

      if (target_user_id === userId) {
        return res.status(400).json({
          success: false,
          message: "Cannot connect to yourself",
        });
      }

      // Check if direct connection already exists
      const { data: existingConnection, error: existingError } =
        await supabaseAdmin
          .from("conversations")
          .select("id")
          .or(
            `and(brand_owner_id.eq.${userId},influencer_id.eq.${target_user_id}),and(brand_owner_id.eq.${target_user_id},influencer_id.eq.${userId})`
          )
          .is("campaign_id", null)
          .is("bid_id", null)
          .single();

      if (existingConnection) {
        return res.status(409).json({
          success: false,
          message: "Direct connection already exists",
          data: { conversation_id: existingConnection.id },
        });
      }

      // Create direct connection conversation
      const { data: conversation, error } = await supabaseAdmin
        .from("conversations")
        .insert({
          brand_owner_id: userId,
          influencer_id: target_user_id,
          chat_status: "realtime",
          payment_required: false,
          payment_completed: false,
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to create direct connection",
        });
      }

      res.status(201).json({
        success: true,
        conversation: conversation,
        message: "Direct connection created successfully",
      });
    } catch (error) {
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
      const { button_id, additional_data } = req.body;
      const userId = req.user.id;

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
              chat_status: "realtime",
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
        io.to(`conversation_${conversation_id}`).emit("button_action", {
          button_id,
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
      console.error("Button click error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle text input from frontend
   */
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
            chat_status: "realtime",
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
          .select("id, name, role")
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
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)
        .limit(limit);

      // Filter by user role and participation
      if (userRole === "brand_owner") {
        query = query.eq("brand_owner_id", userId);
      } else if (userRole === "influencer") {
        query = query.eq("influencer_id", userId);
      }

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
          .select("id, name, role")
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

      // Get campaign conversations only (must have campaign_id, no bid_id)
      let query = supabaseAdmin
        .from("conversations")
        .select(
          `
          id, brand_owner_id, influencer_id, campaign_id, chat_status, 
          created_at, updated_at, flow_state, awaiting_role,
          campaigns!inner(
            id, title, description, min_budget, max_budget, status, requirements,
            language, platform, content_type, campaign_type, deliverables
          )
        `
        )
        .not("campaign_id", "is", null)
        .is("bid_id", null) // No bid associated
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)
        .limit(limit);

      // Filter by user role and participation
      if (userRole === "brand_owner") {
        query = query.eq("brand_owner_id", userId);
      } else if (userRole === "influencer") {
        query = query.eq("influencer_id", userId);
      }

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
          .select("id, name, role")
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
    .isString()
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage("Message must be between 1 and 1000 characters"),

  body("media_url")
    .optional()
    .isURL()
    .withMessage("Media URL must be a valid URL"),

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
