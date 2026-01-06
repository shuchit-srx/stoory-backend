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

    // Get pagination params
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    // Get chat history
    const messages = await ChatService.getChatHistory(applicationId, limit, offset);

    res.json({ 
      success: true, 
      data: messages,
      pagination: {
        limit,
        offset,
        count: messages.length
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
        message: 'Access denied to this application' 
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
 * Get chat details for an application
 * GET /api/v1/chat/:applicationId
 */
const getChat = async (req, res) => {
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
        message: 'Access denied to this application' 
      });
    }

    // Get chat
    const chat = await ChatService.getChatByApplication(applicationId);

    if (!chat) {
      return res.status(404).json({ 
        success: false, 
        message: 'Chat not found for this application' 
      });
    }

    res.json({ 
      success: true, 
      data: chat
    });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get chat' 
    });
  }
};

module.exports = {
  getHistory,
  createChat,
  getChat
};