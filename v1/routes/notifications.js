const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const authMiddleware = require('../middleware/authMiddleware');
const { validateRegisterToken, validateUnregisterToken, validateTestNotification } = require('../validators');

// Get notifications
router.get('/', authMiddleware.authenticateToken, notificationController.getNotifications.bind(notificationController));

// Get unread count
router.get('/unread/count', authMiddleware.authenticateToken, notificationController.getUnreadCount.bind(notificationController));

// Mark all as read
router.patch('/read/all', authMiddleware.authenticateToken, notificationController.markAllAsRead.bind(notificationController));

// Mark as read
router.patch('/:id/read', authMiddleware.authenticateToken, notificationController.markAsRead.bind(notificationController));

// Delete specific notification
router.delete('/:id', authMiddleware.authenticateToken, notificationController.deleteNotification.bind(notificationController));

// Delete all notifications (or only read notifications)
router.delete('/', authMiddleware.authenticateToken, notificationController.deleteAllNotifications.bind(notificationController));

// Delivery stats
router.get(
  '/:id/delivery-stats',
  authMiddleware.authenticateToken,
  notificationController.getDeliveryStats.bind(notificationController),
);

// Retry
router.post(
  '/:id/retry',
  authMiddleware.authenticateToken,
  notificationController.retryNotification.bind(notificationController),
);

// FCM Token Registration
router.post(
  '/fcm/register',
  authMiddleware.authenticateToken,
  validateRegisterToken,
  notificationController.registerFCMToken.bind(notificationController)
);

// FCM Token Unregistration
router.post(
  '/fcm/unregister',
  authMiddleware.authenticateToken,
  validateUnregisterToken,
  notificationController.unregisterFCMToken.bind(notificationController)
);

// Get FCM Tokens
router.get(
  '/fcm/tokens',
  authMiddleware.authenticateToken,
  notificationController.getFCMTokens.bind(notificationController)
);

// Send Test Notification
router.post(
  '/fcm/test',
  authMiddleware.authenticateToken,
  validateTestNotification,
  notificationController.sendTestNotification.bind(notificationController)
);

// FCM Status
router.get(
  '/fcm/status',
  authMiddleware.authenticateToken,
  notificationController.getFCMStatus.bind(notificationController)
);

// Cleanup Inactive Tokens (Admin Only)
router.post(
  '/fcm/cleanup',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('ADMIN'),
  notificationController.cleanupInactiveTokens.bind(notificationController)
);

module.exports = router;

