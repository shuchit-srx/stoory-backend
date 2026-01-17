const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * GET /api/v1/chat/:applicationId/history
 * Get chat history for an application
 * Query params: limit (default: 50, max: 100), offset (default: 0)
 */
router.get(
  '/:applicationId/history', 
  authMiddleware.authenticateToken,
  chatController.getHistory
);

/**
 * POST /api/v1/chat/:applicationId
 * Create a chat for an application (typically called when application is accepted)
 * Access: Brand owner or system
 */
router.post(
  '/:applicationId',
  authMiddleware.authenticateToken,
  chatController.createChat
);

/**
 * GET /api/v1/chat/:applicationId
 * Get chat details for an application
 */
router.get(
  '/:applicationId',
  authMiddleware.authenticateToken,
  chatController.getChat
);

/**
 * GET /api/v1/chat/user/chats
 * Get all chat IDs for the authenticated user (influencer or brand_owner)
 */
router.get(
  '/user/my-chats',
  authMiddleware.authenticateToken,
  chatController.getUserChats
);

module.exports = router;