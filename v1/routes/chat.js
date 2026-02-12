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
 * GET /api/v1/chat/user/my-chats
 * Get all chat IDs for the authenticated user (influencer or brand_owner)
 * NOTE: This specific route must be defined before the generic /:chatId route
 */
router.get(
  '/user/my-chats',
  authMiddleware.authenticateToken,
  chatController.getUserChats
);

/**
 * DELETE /api/v1/chat/attachments/:attachmentId
 * Delete attachment
 * Response: { success: true, message: 'Attachment deleted successfully' }
 * NOTE: Must be defined before /:chatId route to avoid conflicts
 */
router.delete(
  '/attachments/:attachmentId',
  authMiddleware.authenticateToken,
  chatController.deleteAttachment
);

/**
 * GET /api/v1/chat/attachments/:attachmentId
 * Get attachment info
 * Response: { success: true, attachment: {...} }
 * NOTE: Must be defined before /:chatId route to avoid conflicts
 */
router.get(
  '/attachments/:attachmentId',
  authMiddleware.authenticateToken,
  chatController.getAttachmentInfo
);

/**
 * GET /api/v1/chat/unread/count
 * Get unread count for all user chats
 * Response: { success: true, data: { totalUnreadCount, chats: [...] } }
 */
router.get(
  '/unread/count',
  authMiddleware.authenticateToken,
  chatController.getAllUnreadCount
);

/**
 * GET /api/v1/chat/messages/:messageId/read-receipts
 * Get read receipts for a message
 * Response: { success: true, data: [...] }
 */
router.get(
  '/messages/:messageId/read-receipts',
  authMiddleware.authenticateToken,
  chatController.getReadReceipts
);

/**
 * POST /api/v1/chat/messages/:messageId/read
 * Mark a message as read
 * Response: { success: true, data: {...}, message: 'Message marked as read' }
 */
router.post(
  '/messages/:messageId/read',
  authMiddleware.authenticateToken,
  chatController.markMessageAsRead
);

/**
 * GET /api/v1/chat/:chatId/unread-count
 * Get unread message count for a specific chat
 * Response: { success: true, data: { chatId, unreadCount } }
 * NOTE: Must be defined before /:chatId route to avoid conflicts
 */
router.get(
  '/:chatId/unread-count',
  authMiddleware.authenticateToken,
  chatController.getUnreadCount
);

/**
 * POST /api/v1/chat/:chatId/mark-all-read
 * Mark all messages in a chat as read
 * Response: { success: true, data: { markedCount, readReceipts: [...] } }
 * NOTE: Must be defined before /:chatId route to avoid conflicts
 */
router.post(
  '/:chatId/mark-all-read',
  authMiddleware.authenticateToken,
  chatController.markAllAsRead
);

/**
 * POST /api/v1/chat/:chatId/upload
 * Upload attachment for a chat
 * Request Body: { fileName, mimeType, fileData (base64) }
 * Response: { success: true, attachment: {...}, preview: {...} }
 * NOTE: Must be defined before /:chatId route to avoid conflicts
 */
router.post(
  '/:chatId/upload',
  authMiddleware.authenticateToken,
  chatController.uploadAttachment
);

/**
 * POST /api/v1/chat/:chatId/send-with-attachment
 * Send message with attachment
 * Request Body: { message (optional), fileName, mimeType, fileData (base64) }
 * Response: { success: true, message: {...}, attachment: {...}, preview: {...} }
 * NOTE: Must be defined before /:chatId route to avoid conflicts
 */
router.post(
  '/:chatId/send-with-attachment',
  authMiddleware.authenticateToken,
  chatController.sendMessageWithAttachment
);

/**
 * POST /api/v1/chat/:chatId/upload-formdata
 * Upload with FormData (for Android content URIs)
 * Request: multipart/form-data with 'file' field and optional 'message' field
 * Response: { success: true, message: {...}, attachment: {...}, preview: {...} }
 * NOTE: Must be defined before /:chatId route to avoid conflicts
 */
router.post(
  '/:chatId/upload-formdata',
  authMiddleware.authenticateToken,
  chatController.uploadWithFormData
);

/**
 * GET /api/v1/chat/:chatId
 * Get chat details by chat ID
 * NOTE: This parameterized route must come after all specific routes
 */
router.get(
  '/:chatId',
  authMiddleware.authenticateToken,
  chatController.getChat
);

module.exports = router;