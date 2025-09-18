const { body, validationResult } = require('express-validator');
const fcmService = require('../services/fcmService');

class FCMController {
  /**
   * Register FCM token for a user
   */
  async registerToken(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { token, device_type = 'web', device_id } = req.body;
      const userId = req.user.id;

      const result = await fcmService.registerToken(userId, token, device_type, device_id);

      if (result.success) {
        res.json({
          success: true,
          message: 'FCM token registered successfully',
          data: result.data
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to register FCM token',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in registerToken:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Unregister FCM token
   */
  async unregisterToken(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { token } = req.body;
      const userId = req.user.id;

      const result = await fcmService.unregisterToken(userId, token);

      if (result.success) {
        res.json({
          success: true,
          message: 'FCM token unregistered successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to unregister FCM token',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in unregisterToken:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get user's FCM tokens
   */
  async getUserTokens(req, res) {
    try {
      const userId = req.user.id;

      const result = await fcmService.getUserTokens(userId);

      if (result.success) {
        res.json({
          success: true,
          tokens: result.tokens
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to get FCM tokens',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in getUserTokens:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Send test notification
   */
  async sendTestNotification(req, res) {
    try {
      const { title, body, data } = req.body;
      const userId = req.user.id;

      const notification = {
        title: title || 'Test Notification',
        body: body || 'This is a test notification from Stoory',
        data: data || { type: 'test' }
      };

      const result = await fcmService.sendNotificationToUser(userId, notification);

      if (result.success) {
        res.json({
          success: true,
          message: 'Test notification sent',
          sent: result.sent,
          failed: result.failed
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to send test notification',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in sendTestNotification:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Cleanup inactive tokens (admin only)
   */
  async cleanupInactiveTokens(req, res) {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Admin role required.'
        });
      }

      const result = await fcmService.cleanupInactiveTokens();

      if (result.success) {
        res.json({
          success: true,
          message: 'Inactive tokens cleaned up successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to cleanup inactive tokens',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in cleanupInactiveTokens:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

// Validation middleware
const validateRegisterToken = [
  body('token')
    .isString()
    .notEmpty()
    .withMessage('FCM token is required'),
  
  body('device_type')
    .optional()
    .isIn(['web', 'android', 'ios'])
    .withMessage('Device type must be web, android, or ios'),
  
  body('device_id')
    .optional()
    .isString()
    .withMessage('Device ID must be a string')
];

const validateUnregisterToken = [
  body('token')
    .isString()
    .notEmpty()
    .withMessage('FCM token is required')
];

const validateTestNotification = [
  body('title')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('Title must be a string with max 100 characters'),
  
  body('body')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('Body must be a string with max 200 characters'),
  
  body('data')
    .optional()
    .isObject()
    .withMessage('Data must be an object')
];

module.exports = {
  FCMController: new FCMController(),
  validateRegisterToken,
  validateUnregisterToken,
  validateTestNotification
};
