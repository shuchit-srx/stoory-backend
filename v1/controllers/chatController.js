const { ChatService } = require('../services');

/**
 * Get chat history for an application
 * GET /api/v1/chat/:applicationId/history
 */
const getHistory = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const userId = req.user.id;
    
    // Input validation
    if (!applicationId) {
      return res.status(400).json({ 
        success: false, 
        message: 'applicationId is required' 
      });
    }

    // Validate user access
    const hasAccess = await ChatService.validateUserAccess(userId, applicationId);
    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this application' 
      });
    }

    // Get pagination params - Standardized pagination
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Default 20, max 100
    const offset = parseInt(req.query.offset) || 0;

    // Validate pagination
    if (isNaN(limit) || limit < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid limit. Must be >= 1",
      });
    }

    if (isNaN(offset) || offset < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offset. Must be >= 0",
      });
    }

    // Get chat history
    const result = await ChatService.getChatHistory(applicationId, limit, offset);

    res.json({ 
      success: true, 
      data: result.messages || [],
      pagination: result.pagination || {
        limit,
        offset,
        count: (result.messages || []).length,
        total: result.total || 0,
        hasMore: result.hasMore || false,
      }
    });
  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get chat history' 
    });
  }
};

/**
 * Create a chat for an application
 * POST /api/v1/chat/:applicationId
 */
const createChat = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const userId = req.user.id;

    if (!applicationId) {
      return res.status(400).json({ 
        success: false, 
        message: 'applicationId is required' 
      });
    }

    // Validate user access
    const hasAccess = await ChatService.validateUserAccess(userId, applicationId);
    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this application. Invalid user access' 
      });
    }

    // Create chat
    const chat = await ChatService.createChat(applicationId);

    res.status(201).json({ 
      success: true, 
      data: chat,
      message: 'Chat created successfully'
    });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create chat' 
    });
  }
};

/**
 * Get chat details by chat ID
 * GET /api/v1/chat/:chatId
 */
const getChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    if (!chatId) {
      return res.status(400).json({ 
        success: false, 
        message: 'chatId is required' 
      });
    }

    // Get chat (access validation is done inside getChatById)
    const chat = await ChatService.getChatById(chatId, userId);

    if (!chat) {
      return res.status(404).json({ 
        success: false, 
        message: 'Chat not found' 
      });
    }

    res.json({ 
      success: true, 
      data: chat
    });
  } catch (error) {
    console.error('Get chat error:', error);
    if (error.message === 'Access denied to this chat') {
      return res.status(403).json({ 
        success: false, 
        message: error.message 
      });
    }
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get chat' 
    });
  }
};

/**
 * Get all chat IDs for the authenticated user
 * GET /api/v1/chat/user/chats
 */
const getUserChats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all chats for this user
    const chats = await ChatService.getUserChats(userId);

    res.json({
      success: true,
      data: chats,
      count: chats.length
    });
  } catch (error) {
    console.error('Get user chats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get user chats'
    });
  }
};

module.exports = {
  getHistory,
  createChat,
  getChat,
  getUserChats
};