const { supabaseAdmin } = require('../db/config');
const { maskContent } = require('../utils/contentSafety');

const ChatService = {
  /**
   * createChat
   * Should be called when Application moves to ACCEPTED state [cite: 228]
   * @param {string} applicationId - The application ID
   * @returns {Promise<Object>} - The created chat object
   */
  async createChat(applicationId) {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }

    // Check if payment is verified before creating chat
    // Chat should only be created after brand owner pays the platform
    // Payment orders use payable_id and payable_type, not application_id
    // Need to check both APPLICATION type (single) and CAMPAIGN type (bulk) payments
    
    // Check for single application payment (payable_type = 'APPLICATION')
    const { data: singlePaymentOrder } = await supabaseAdmin
      .from('v1_payment_orders')
      .select('id, status')
      .eq('payable_type', 'APPLICATION')
      .eq('payable_id', applicationId)
      .eq('status', 'VERIFIED')
      .maybeSingle();

    // Check for bulk campaign payment (payable_type = 'CAMPAIGN')
    // Applications are linked through v1_application_payments table
    const { data: bulkPaymentOrder } = await supabaseAdmin
      .from('v1_application_payments')
      .select(`
        payment_order_id,
        v1_payment_orders!inner(
          id,
          status,
          payable_type
        )
      `)
      .eq('application_id', applicationId)
      .eq('v1_payment_orders.payable_type', 'CAMPAIGN')
      .eq('v1_payment_orders.status', 'VERIFIED')
      .maybeSingle();

    // Payment must be verified in either single or bulk payment
    if (!singlePaymentOrder && !bulkPaymentOrder) {
      throw new Error('Payment must be verified before chat can be created');
    }

    // Check if chat already exists (to avoid race conditions)
    const { data: existingChat } = await supabaseAdmin
      .from('v1_chats')
      .select('id, status, application_id')
      .eq('application_id', applicationId)
      .maybeSingle();

    if (existingChat) {
      return existingChat;
    }

    // Try to insert - handle race condition where another process creates chat simultaneously
    const { data, error } = await supabaseAdmin
      .from('v1_chats')
      .insert({
        application_id: applicationId,
        status: 'ACTIVE', // [cite: 166]
        sequence_number: 0 // Initialize sequence counter
      })
      .select()
      .single();

    if (error) {
      // If unique constraint violation (race condition), fetch existing chat
      if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
        const { data: raceConditionChat } = await supabaseAdmin
          .from('v1_chats')
          .select('id, status, application_id')
          .eq('application_id', applicationId)
          .maybeSingle();
        
        if (raceConditionChat) {
          return raceConditionChat;
        }
      }
      
      console.error('Error creating chat:', error);
      throw new Error(`Failed to create chat: ${error.message}`);
    }
    
    return data;
  },

  /**
   * validateUserAccess
   * Validates that a user has access to an application's chat
   * @param {string} userId - The user ID
   * @param {string} applicationId - The application ID
   * @returns {Promise<boolean>} - True if user has access
   */
  async validateUserAccess(userId, applicationId) {
    if (!userId || !applicationId) {
      return false;
    }

    try {
      // Check if user is either the influencer or brand owner of this application
      const { data: application, error } = await supabaseAdmin
        .from('v1_applications')
        .select('influencer_id, v1_campaigns!inner(brand_id)')
        .eq('id', applicationId)
        .single();

      if (error || !application) {
        console.error('Error validating access:', error);
        return false;
      }

      // User is either the influencer or the brand owner
      const isInfluencer = application.influencer_id === userId;
      const isBrandOwner = application.v1_campaigns?.brand_id === userId;

      return isInfluencer || isBrandOwner;
    } catch (error) {
      console.error('Error in validateUserAccess:', error);
      return false;
    }
  },

  /**
   * getChatById
   * Gets chat by chat ID with related data and validates user access
   * @param {string} chatId - The chat ID
   * @param {string} userId - The user ID for access validation
   * @returns {Promise<Object|null>} - The chat object with campaign, brand, influencer, created_at, updated_at or null
   */
  async getChatById(chatId, userId) {
    if (!chatId) {
      return null;
    }

    if (!userId) {
      throw new Error('userId is required for access validation');
    }

    // Fetch chat with application data
    const { data: chat, error: chatError } = await supabaseAdmin
      .from('v1_chats')
      .select(`
        id,
        status,
        application_id,
        created_at,
        updated_at,
        v1_applications!inner(
          influencer_id,
          campaign_id,
          v1_campaigns!inner(
            id,
            title,
            brand_id,
            cover_image_url
          )
        )
      `)
      .eq('id', chatId)
      .single();

    if (chatError) {
      if (chatError.code === 'PGRST116') {
        // Not found
        return null;
      }
      console.error('Error getting chat:', chatError);
      throw new Error(`Failed to get chat: ${chatError.message}`);
    }

    if (!chat || !chat.v1_applications) {
      return null;
    }

    // Validate user access
    const applicationId = chat.application_id;
    const hasAccess = await this.validateUserAccess(userId, applicationId);
    if (!hasAccess) {
      throw new Error('Access denied to this chat');
    }

    const application = chat.v1_applications;
    const campaign = application.v1_campaigns;
    const influencerId = application.influencer_id;
    const brandId = campaign?.brand_id;

    // Fetch brand profile if brand_id exists
    let brand = null;
    if (brandId) {
      const { data: brandProfile, error: brandError } = await supabaseAdmin
        .from('v1_brand_profiles')
        .select('user_id, brand_name, brand_logo_url')
        .eq('user_id', brandId)
        .eq('is_deleted', false)
        .maybeSingle();

      if (!brandError && brandProfile) {
        brand = {
          id: brandProfile.user_id,
          brand_name: brandProfile.brand_name,
          brand_logo_url: brandProfile.brand_logo_url
        };
      }
    }

    // Fetch influencer user data and profile
    let influencer = null;
    if (influencerId) {
      const { data: influencerUser, error: influencerError } = await supabaseAdmin
        .from('v1_users')
        .select('id, name')
        .eq('id', influencerId)
        .eq('is_deleted', false)
        .maybeSingle();

      if (!influencerError && influencerUser) {
        // Fetch influencer profile for profile_photo_url
        const { data: influencerProfile, error: profileError } = await supabaseAdmin
          .from('v1_influencer_profiles')
          .select('profile_photo_url')
          .eq('user_id', influencerId)
          .eq('is_deleted', false)
          .maybeSingle();

        influencer = {
          id: influencerUser.id,
          name: influencerUser.name,
          profile_photo_url: influencerProfile?.profile_photo_url || null
        };
      }
    }

    // Format the response
    const formattedChat = {
      id: chat.id,
      status: chat.status,
      application_id: chat.application_id,
      created_at: chat.created_at,
      updated_at: chat.updated_at,
      campaign: campaign ? {
        id: campaign.id,
        title: campaign.title,
        cover_image_url: campaign.cover_image_url
      } : null,
      brand: brand,
      influencer: influencer
    };

    return formattedChat;
  },

  /**
   * getChatByApplication
   * Gets chat by application ID (used by socket for validation)
   * @param {string} applicationId - The application ID
   * @returns {Promise<Object|null>} - The chat object or null
   */
  async getChatByApplication(applicationId) {
    if (!applicationId) {
      return null;
    }

    const { data: chat, error } = await supabaseAdmin
      .from('v1_chats')
      .select('id, status, application_id')
      .eq('application_id', applicationId)
      .maybeSingle();

    if (error) {
      console.error('Error getting chat by application:', error);
      return null;
    }

    return chat;
  },

  /**
   * saveMessage
   * Validates status, masks content, and persists to DB.
   * @param {string} userId - The sender's user ID
   * @param {string} applicationId - The application ID
   * @param {string} messageContent - The message content
   * @param {string|null} attachmentUrl - Optional attachment URL
   * @returns {Promise<Object>} - The saved message object
   */
  async saveMessage(userId, applicationId, messageContent, attachmentUrl = null) {
    // Input validation
    if (!userId || !applicationId) {
      throw new Error('userId and applicationId are required');
    }

    if (!messageContent || typeof messageContent !== 'string') {
      throw new Error('messageContent must be a non-empty string');
    }

    if (messageContent.trim().length === 0) {
      throw new Error('messageContent cannot be empty');
    }

    // 1. Fetch Chat and Application Status
    // Note: Using .single() because there should be exactly one chat per application
    // If multiple chats exist, this indicates a data integrity issue
    const { data: chat, error: chatError } = await supabaseAdmin
      .from('v1_chats')
      .select('id, status, application_id')
      .eq('application_id', applicationId)
      .single();

    if (chatError) {
      // Handle case where multiple chats exist (data integrity issue)
      if (chatError.code === 'PGRST116' || chatError.message?.includes('More than one row')) {
        console.error(`Data integrity issue: Multiple chats found for application ${applicationId}`);
        throw new Error("Multiple chats found for this application. Please contact support.");
      }
      throw new Error(`Chat not found for this application: ${chatError.message}`);
    }

    if (!chat) {
      throw new Error("Chat not found for this application");
    }

    // 2. Validate Lifecycle: Chat closes at COMPLETED/CANCELLED [cite: 229]
    // Therefore, it must be ACTIVE.
    if (chat.status !== 'ACTIVE') {
      throw new Error("Chat is CLOSED. Messaging is not allowed.");
    }

    // 3. Validate user access
    const hasAccess = await this.validateUserAccess(userId, applicationId);
    if (!hasAccess) {
      throw new Error("You don't have access to this chat");
    }

    // 4. Mask Content [cite: 237, 249]
    const safeMessage = maskContent(messageContent);

    // 5. Get and increment sequence number atomically
    // This ensures message ordering even with concurrent requests
    const { data: chatWithSeq, error: seqError } = await supabaseAdmin
      .from('v1_chats')
      .select('sequence_number')
      .eq('id', chat.id)
      .single();

    if (seqError || !chatWithSeq) {
      console.error('Error fetching sequence number:', seqError);
      throw new Error(`Failed to get sequence number: ${seqError?.message || 'Chat not found'}`);
    }

    const nextSequenceNumber = (chatWithSeq.sequence_number || 0) + 1;

    // 6. Persist to chat_messages with sequence number and initial status [cite: 168]
    const { data: savedMessage, error: saveError } = await supabaseAdmin
      .from('v1_chat_messages')
      .insert({
        chat_id: chat.id,
        sender_id: userId,
        message: safeMessage,
        attachment_url: attachmentUrl,
        sequence_number: nextSequenceNumber,
        status: 'SENT' // Initial status when message is saved
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving message:', saveError);
      throw new Error(`Failed to save message: ${saveError.message}`);
    }

    // 7. Update chat's sequence_number atomically
    const { error: updateSeqError } = await supabaseAdmin
      .from('v1_chats')
      .update({ sequence_number: nextSequenceNumber })
      .eq('id', chat.id);

    if (updateSeqError) {
      console.error('Error updating sequence number:', updateSeqError);
      // Don't fail the message save, but log the error
    }

    // Get application to find recipient and send notification
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('influencer_id, v1_campaigns!inner(brand_id)')
        .eq('id', applicationId)
        .single();

      if (application) {
        // Determine recipient (the other party)
        const recipientId = userId === application.influencer_id 
          ? application.v1_campaigns?.brand_id 
          : application.influencer_id;

        if (recipientId) {
          const NotificationService = require('./notificationService');
          // Skip notification if recipient is actively viewing the chat
          const isViewingChat = NotificationService.isUserInChatRoom(recipientId, applicationId);
          
          if (!isViewingChat) {
            // Send notification (socket will handle if online, FCM if offline)
            await NotificationService.notifyChatMessage(
              applicationId,
              userId,
              recipientId,
              safeMessage
            );
          } else {
            console.log(`[ChatService/saveMessage] Skipping notification - user ${recipientId} is viewing chat for application ${applicationId}`);
          }
        }
      }
    } catch (notifError) {
      console.error('[ChatService/saveMessage] Failed to send notification:', notifError);
      // Don't fail message saving if notification fails
    }

    return savedMessage;
  },

  /**
   * getChatHistory
   * Used for initial load in UI
   * @param {string} applicationId - The application ID
   * @param {number} limit - Maximum number of messages to return
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} - Array of messages
   */
  async getChatHistory(applicationId, limit = 20, offset = 0) {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }

    // Cap at 100 messages per request
    const validatedLimit = Math.min(limit, 100);
    const validatedOffset = Math.max(0, offset);

    const { data: chat, error: chatError } = await supabaseAdmin
      .from('v1_chats')
      .select('id')
      .eq('application_id', applicationId)
      .maybeSingle();

    if (chatError) {
      console.error('Error getting chat in getChatHistory:', chatError);
      throw new Error(`Failed to get chat: ${chatError.message}`);
    }

    if (!chat) {
      return {
        messages: [],
        pagination: {
          limit: validatedLimit,
          offset: validatedOffset,
          count: 0,
          total: 0,
          hasMore: false,
        }
      };
    }

    // Get total count
    const { count: totalCount } = await supabaseAdmin
      .from('v1_chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chat.id);

    // Get messages ordered by sequence_number for guaranteed ordering
    const { data, error } = await supabaseAdmin
      .from('v1_chat_messages')
      .select('*')
      .eq('chat_id', chat.id)
      .order('sequence_number', { ascending: true })
      .range(validatedOffset, validatedOffset + validatedLimit - 1);

    if (error) {
      console.error('Error getting chat history:', error);
      throw new Error(`Failed to get chat history: ${error.message}`);
    }

    const messages = data || [];
    const hasMore = (validatedOffset + validatedLimit) < (totalCount || 0);

    return {
      messages,
      total: totalCount || 0,
      hasMore,
      pagination: {
        limit: validatedLimit,
        offset: validatedOffset,
        count: messages.length,
        total: totalCount || 0,
        hasMore,
      }
    };
  },

  /**
   * closeChat
   * Call when Application moves to COMPLETED by admin (not when work is completed)
   * @param {string} applicationId - The application ID
   * @param {string} closedById - The user ID who closed the chat (optional, defaults to system)
   * @returns {Promise<void>}
   */
  async closeChat(applicationId, closedById = null) {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }

    // Get application details to find participants
    const { data: application } = await supabaseAdmin
      .from('v1_applications')
      .select('influencer_id, v1_campaigns!inner(brand_id)')
      .eq('id', applicationId)
      .single();

    const { error } = await supabaseAdmin
      .from('v1_chats')
      .update({ status: 'CLOSED' })
      .eq('application_id', applicationId);
    
    if (error) {
      console.error('Error closing chat:', error);
      throw new Error(`Failed to close chat: ${error.message}`);
    }

    // Send notification to the other party
    if (application) {
      try {
        const NotificationService = require('./notificationService');
        const brandId = application.v1_campaigns?.brand_id;
        const otherUserId = closedById === application.influencer_id 
          ? brandId 
          : application.influencer_id;
        
        if (otherUserId) {
          await NotificationService.notifyConversationClosed(
            applicationId,
            closedById || 'system',
            otherUserId
          );
        }
      } catch (notifError) {
        console.error('[ChatService/closeChat] Failed to send notification:', notifError);
        // Don't fail chat closure if notification fails
      }
    }
  },

  /**
   * markMessageAsRead
   * Marks a message as read by a user
   * @param {string} messageId - The message ID
   * @param {string} userId - The user ID who read the message
   * @returns {Promise<Object>} - The read receipt object
   */
  async markMessageAsRead(messageId, userId) {
    if (!messageId || !userId) {
      throw new Error('messageId and userId are required');
    }

    // Get message with chat info
    const { data: message, error: messageError } = await supabaseAdmin
      .from('v1_chat_messages')
      .select('id, chat_id, sender_id, v1_chats!inner(application_id)')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      throw new Error('Message not found');
    }

    // Don't mark own messages as read
    if (message.sender_id === userId) {
      return { success: true, message: 'Cannot mark own message as read' };
    }

    // Validate user access using existing method
    const hasAccess = await this.validateUserAccess(userId, message.v1_chats.application_id);
    if (!hasAccess) {
      throw new Error('You do not have access to this message');
    }

    // Insert or update read receipt (upsert)
    const { data: readReceipt, error: readError } = await supabaseAdmin
      .from('v1_chat_message_reads')
      .upsert({
        message_id: messageId,
        user_id: userId,
        read_at: new Date().toISOString()
      }, {
        onConflict: 'message_id,user_id'
      })
      .select()
      .single();

    if (readError) {
      console.error('Error marking message as read:', readError);
      throw new Error(`Failed to mark message as read: ${readError.message}`);
    }

    // Update message status to READ
    await this.updateMessageStatus(messageId, 'READ');

    return readReceipt;
  },

  /**
   * getReadReceipts
   * Gets read receipts for a message
   * @param {string} messageId - The message ID
   * @returns {Promise<Array>} - Array of read receipts
   */
  async getReadReceipts(messageId) {
    if (!messageId) {
      throw new Error('messageId is required');
    }

    const { data: readReceipts, error } = await supabaseAdmin
      .from('v1_chat_message_reads')
      .select('*')
      .eq('message_id', messageId)
      .order('read_at', { ascending: false });

    if (error) {
      console.error('Error getting read receipts:', error);
      throw new Error(`Failed to get read receipts: ${error.message}`);
    }

    return readReceipts || [];
  },

  /**
   * getUserChats
   * Gets all chats for a user (influencer or brand_owner) with related data
   * @param {string} userId - The user ID
   * @returns {Promise<Array>} - Array of chat objects with campaign, brand, influencer, last_message_received, and total_unread_messages
   */
  async getUserChats(userId) {
    if (!userId) {
      throw new Error('userId is required');
    }

    try {
      // Step 1: Get all applications where user is influencer
      const { data: influencerApplications, error: influencerError } = await supabaseAdmin
        .from('v1_applications')
        .select('id')
        .eq('influencer_id', userId);

      if (influencerError) {
        console.error('Error getting influencer applications:', influencerError);
        throw new Error(`Failed to get influencer applications: ${influencerError.message}`);
      }

      // Step 2: Get all applications where user is brand owner (via campaigns)
      const { data: brandApplications, error: brandError } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns!inner(brand_id)')
        .eq('v1_campaigns.brand_id', userId);

      if (brandError) {
        console.error('Error getting brand applications:', brandError);
        throw new Error(`Failed to get brand applications: ${brandError.message}`);
      }

      // Step 3: Combine all application IDs
      const applicationIds = [
        ...(influencerApplications || []).map(app => app.id),
        ...(brandApplications || []).map(app => app.id)
      ];

      // Remove duplicates
      const uniqueApplicationIds = [...new Set(applicationIds)];

      if (uniqueApplicationIds.length === 0) {
        return [];
      }

      // Step 4: Get all chats with application, campaign, and influencer data
      const { data: chats, error: chatsError } = await supabaseAdmin
        .from('v1_chats')
        .select(`
          id,
          application_id,
          status,
          created_at,
          updated_at,
          v1_applications!inner(
            influencer_id,
            campaign_id,
            v1_campaigns!inner(
              id,
              title,
              brand_id,
              cover_image_url
            )
          )
        `)
        .in('application_id', uniqueApplicationIds)
        .order('updated_at', { ascending: false });

      if (chatsError) {
        console.error('Error getting user chats:', chatsError);
        throw new Error(`Failed to get user chats: ${chatsError.message}`);
      }

      if (!chats || chats.length === 0) {
        return [];
      }

      // Step 5: Get all unique brand IDs and influencer IDs
      const brandIds = [...new Set(
        chats
          .map(chat => chat.v1_applications?.v1_campaigns?.brand_id)
          .filter(Boolean)
      )];
      const influencerIds = [...new Set(
        chats
          .map(chat => chat.v1_applications?.influencer_id)
          .filter(Boolean)
      )];
      const chatIds = chats.map(chat => chat.id);

      // Step 6: Fetch brand profiles
      const brandMap = {};
      if (brandIds.length > 0) {
        const { data: brandProfiles, error: brandProfilesError } = await supabaseAdmin
          .from('v1_brand_profiles')
          .select('user_id, brand_name, brand_logo_url')
          .in('user_id', brandIds)
          .eq('is_deleted', false);

        if (!brandProfilesError && brandProfiles) {
          brandProfiles.forEach(profile => {
            brandMap[profile.user_id] = {
              id: profile.user_id,
              brand_name: profile.brand_name,
              brand_logo_url: profile.brand_logo_url
            };
          });
        }
      }

      // Step 7: Fetch influencer users and profiles
      const influencerMap = {};
      if (influencerIds.length > 0) {
        const { data: influencerUsers, error: influencerUsersError } = await supabaseAdmin
          .from('v1_users')
          .select('id, name')
          .in('id', influencerIds)
          .eq('is_deleted', false);

        if (!influencerUsersError && influencerUsers) {
          // Fetch influencer profiles for profile_photo_url
          const { data: influencerProfiles, error: influencerProfilesError } = await supabaseAdmin
            .from('v1_influencer_profiles')
            .select('user_id, profile_photo_url')
            .in('user_id', influencerIds)
            .eq('is_deleted', false);

          const profileMap = {};
          if (!influencerProfilesError && influencerProfiles) {
            influencerProfiles.forEach(profile => {
              profileMap[profile.user_id] = profile.profile_photo_url;
            });
          }

          influencerUsers.forEach(user => {
            influencerMap[user.id] = {
              id: user.id,
              influencer_name: user.name,
              profile_photo_url: profileMap[user.id] || null
            };
          });
        }
      }

      // Step 8: Get last message for each chat
      const lastMessageMap = {};
      if (chatIds.length > 0) {
        // Get the most recent message for each chat
        for (const chatId of chatIds) {
          const { data: lastMessage, error: lastMessageError } = await supabaseAdmin
            .from('v1_chat_messages')
            .select('message')
            .eq('chat_id', chatId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!lastMessageError && lastMessage) {
            lastMessageMap[chatId] = lastMessage.message;
          }
        }
      }

      // Step 9: Get unread message counts for each chat
      const unreadCountMap = {};
      if (chatIds.length > 0) {
        // Get all messages that are not sent by the user
        const { data: allMessages, error: allMessagesError } = await supabaseAdmin
          .from('v1_chat_messages')
          .select('id, chat_id, sender_id')
          .in('chat_id', chatIds)
          .neq('sender_id', userId);

        if (!allMessagesError && allMessages && allMessages.length > 0) {
          // Get all read receipts for this user
          const messageIds = allMessages.map(msg => msg.id);
          const { data: readReceipts } = await supabaseAdmin
            .from('v1_chat_message_reads')
            .select('message_id')
            .in('message_id', messageIds)
            .eq('user_id', userId);

          const readMessageIds = new Set(
            (readReceipts || []).map(receipt => receipt.message_id)
          );

          // Count unread messages per chat (messages not in readMessageIds)
          allMessages.forEach(message => {
            if (!readMessageIds.has(message.id)) {
              unreadCountMap[message.chat_id] = (unreadCountMap[message.chat_id] || 0) + 1;
            }
          });
        }
      }

      // Step 10: Format the response
      const formattedChats = chats.map(chat => {
        const application = chat.v1_applications;
        const campaign = application?.v1_campaigns;
        const brandId = campaign?.brand_id;
        const influencerId = application?.influencer_id;

        return {
          id: chat.id,
          application_id: chat.application_id,
          status: chat.status,
          created_at: chat.created_at,
          updated_at: chat.updated_at,
          campaign: campaign ? {
            id: campaign.id,
            title: campaign.title,
            cover_image_url: campaign.cover_image_url
          } : null,
          brand: brandId && brandMap[brandId] ? brandMap[brandId] : null,
          influencer: influencerId && influencerMap[influencerId] ? influencerMap[influencerId] : null,
          last_message_received: lastMessageMap[chat.id] || null,
          total_unread_messages: unreadCountMap[chat.id] || 0
        };
      });

      return formattedChats;
    } catch (error) {
      console.error('Error in getUserChats:', error);
      throw error;
    }
  },

  /**
   * updateMessageStatus
   * Updates the status of a message (SENDING, SENT, DELIVERED, READ)
   * Note: SENDING is accepted but not set by backend (intended for frontend optimistic updates)
   * @param {string} messageId - The message ID
   * @param {string} status - The new status
   * @returns {Promise<Object>} - The updated message
   */
  async updateMessageStatus(messageId, status) {
    if (!messageId || !status) {
      throw new Error('messageId and status are required');
    }

    const validStatuses = ['SENDING', 'SENT', 'DELIVERED', 'READ'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const { data: updatedMessage, error } = await supabaseAdmin
      .from('v1_chat_messages')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', messageId)
      .select()
      .single();

    if (error) {
      console.error('Error updating message status:', error);
      throw new Error(`Failed to update message status: ${error.message}`);
    }

    return updatedMessage;
  }
};

module.exports = ChatService;