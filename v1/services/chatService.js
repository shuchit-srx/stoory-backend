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

    // Check if chat already exists
    const { data: existingChat } = await supabaseAdmin
      .from('chats')
      .select('id')
      .eq('application_id', applicationId)
      .single();

    if (existingChat) {
      return existingChat;
    }

    const { data, error } = await supabaseAdmin
      .from('chats')
      .insert({
        application_id: applicationId,
        status: 'ACTIVE' // [cite: 166]
      })
      .select()
      .single();

    if (error) {
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
        .from('applications')
        .select('influencer_id, campaigns(created_by)')
        .eq('id', applicationId)
        .single();

      if (error || !application) {
        console.error('Error validating access:', error);
        return false;
      }

      // User is either the influencer or the brand owner
      const isInfluencer = application.influencer_id === userId;
      const isBrandOwner = application.campaigns?.created_by === userId;

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

    const { data: chat, error } = await supabaseAdmin
      .from('chats')
      .select('id, status, application_id')
      .eq('application_id', applicationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
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
    const { data: chat, error: chatError } = await supabaseAdmin
      .from('chats')
      .select('id, status, applications(phase)')
      .eq('application_id', applicationId)
      .single();

    if (chatError || !chat) {
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
      .from('chat_messages')
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
  async getChatHistory(applicationId, limit = 50, offset = 0) {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }

    if (limit > 100) {
      limit = 100; // Cap at 100 messages per request
    }

    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('id')
      .eq('application_id', applicationId)
      .single();

    if (!chat) {
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chat.id)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error getting chat history:', error);
      throw new Error(`Failed to get chat history: ${error.message}`);
    }

    return data || [];
  },

  /**
   * closeChat
   * Call when Application moves to COMPLETED or CANCELLED [cite: 229]
   * @param {string} applicationId - The application ID
   * @returns {Promise<void>}
   */
  async closeChat(applicationId) {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }

    const { error } = await supabaseAdmin
      .from('chats')
      .update({ status: 'CLOSED' })
      .eq('application_id', applicationId);
    
    if (error) {
      console.error('Error closing chat:', error);
      throw new Error(`Failed to close chat: ${error.message}`);
    }
  }
};

module.exports = ChatService;