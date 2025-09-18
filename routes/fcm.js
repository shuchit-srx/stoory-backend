const express = require('express');
const { authenticateToken } = require('../utils/auth');
const { 
  FCMController, 
  validateRegisterToken, 
  validateUnregisterToken, 
  validateTestNotification 
} = require('../controllers/fcmController');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @route POST /api/fcm/register
 * @desc Register FCM token for push notifications
 * @access Private
 */
router.post('/register', validateRegisterToken, (req, res) => {
  FCMController.registerToken(req, res);
});

/**
 * @route POST /api/fcm/unregister
 * @desc Unregister FCM token
 * @access Private
 */
router.post('/unregister', validateUnregisterToken, (req, res) => {
  FCMController.unregisterToken(req, res);
});

/**
 * @route GET /api/fcm/tokens
 * @desc Get user's FCM tokens
 * @access Private
 */
router.get('/tokens', (req, res) => {
  FCMController.getUserTokens(req, res);
});

/**
 * @route POST /api/fcm/test
 * @desc Send test notification
 * @access Private
 */
router.post('/test', validateTestNotification, (req, res) => {
  FCMController.sendTestNotification(req, res);
});

/**
 * @route POST /api/fcm/cleanup
 * @desc Cleanup inactive tokens (admin only)
 * @access Private (Admin)
 */
router.post('/cleanup', (req, res) => {
  FCMController.cleanupInactiveTokens(req, res);
});

module.exports = router;
