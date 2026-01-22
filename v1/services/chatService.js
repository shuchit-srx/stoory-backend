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
        status: 'ACTIVE' // [cite: 166]
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
   * getChatByApplication
   * Gets chat by application ID
   * @param {string} applicationId - The application ID
   * @returns {Promise<Object|null>} - The chat object or null
   */
  async getChatByApplication(applicationId) {
    if (!applicationId) {
      return null;
    }

    // Note: Using .single() because there should be exactly one chat per application
    const { data: chat, error } = await supabaseAdmin
      .from('v1_chats')
      .select('id, status, application_id')
      .eq('application_id', applicationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found - this is expected if chat doesn't exist yet
        return null;
      }
      // Handle case where multiple chats exist (data integrity issue)
      if (error.message?.includes('More than one row')) {
        console.error(`Data integrity issue: Multiple chats found for application ${applicationId}`);
        throw new Error("Multiple chats found for this application. Please contact support.");
      }
      console.error('Error getting chat:', error);
      throw new Error(`Failed to get chat: ${error.message}`);
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

    // 5. Persist to chat_messages [cite: 168]
    const { data: savedMessage, error: saveError } = await supabaseAdmin
      .from('v1_chat_messages')
      .insert({
        chat_id: chat.id,
        sender_id: userId,
        message: safeMessage,
        attachment_url: attachmentUrl
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving message:', saveError);
      throw new Error(`Failed to save message: ${saveError.message}`);
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

    // Get messages
    const { data, error } = await supabaseAdmin
      .from('v1_chat_messages')
      .select('*')
      .eq('chat_id', chat.id)
      .order('created_at', { ascending: true })
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
   * @returns {Promise<void>}
   */
  async closeChat(applicationId) {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }

    const { error } = await supabaseAdmin
      .from('v1_chats')
      .update({ status: 'CLOSED' })
      .eq('application_id', applicationId);
    
    if (error) {
      console.error('Error closing chat:', error);
      throw new Error(`Failed to close chat: ${error.message}`);
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
   * Gets all chat IDs for a user (influencer or brand_owner)
   * @param {string} userId - The user ID
   * @returns {Promise<Array>} - Array of chat objects with id, application_id, and status
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

      // Step 4: Get all chats for these applications
      const { data: chats, error: chatsError } = await supabaseAdmin
        .from('v1_chats')
        .select('id, application_id, status, created_at, updated_at')
        .in('application_id', uniqueApplicationIds)
        .order('updated_at', { ascending: false });

      if (chatsError) {
        console.error('Error getting user chats:', chatsError);
        throw new Error(`Failed to get user chats: ${chatsError.message}`);
      }

      return chats || [];
    } catch (error) {
      console.error('Error in getUserChats:', error);
      throw error;
    }
  }
};

module.exports = ChatService;