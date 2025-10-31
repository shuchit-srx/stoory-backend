const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const authService = require('../utils/auth');

// Apply authentication middleware to all routes
router.use(authService.authenticateToken);

/**
 * @route GET /api/notifications
 * @desc Get user notifications
 * @access Private
 */
router.get('/', (req, res) => {
  NotificationController.getNotifications(req, res);
});

/**
 * @route GET /api/notifications/unread-count
 * @desc Get unread notification count
 * @access Private
 */
router.get('/unread-count', (req, res) => {
  NotificationController.getUnreadCount(req, res);
});

/**
 * @route PUT /api/notifications/:notificationId/read
 * @desc Mark notification as read
 * @access Private
 */
router.put('/:notificationId/read', (req, res) => {
  NotificationController.markAsRead(req, res);
});

/**
 * @route PUT /api/notifications/mark-all-read
 * @desc Mark all notifications as read
 * @access Private
 */
router.put('/mark-all-read', (req, res) => {
  NotificationController.markAllAsRead(req, res);
});

/**
 * @route DELETE /api/notifications/:notificationId
 * @desc Delete a single notification
 * @access Private
 */
router.delete('/:notificationId', (req, res) => {
  NotificationController.deleteNotification(req, res);
});

/**
 * @route DELETE /api/notifications
 * @desc Clear all notifications for current user
 * @access Private
 */
router.delete('/', (req, res) => {
  NotificationController.clearAll(req, res);
});

/**
 * @route DELETE /api/notifications/cleanup-expired
 * @desc Clean up expired notifications (admin only)
 * @access Private (Admin)
 */
router.delete('/cleanup-expired', (req, res) => {
  NotificationController.cleanupExpired(req, res);
});

module.exports = router;
