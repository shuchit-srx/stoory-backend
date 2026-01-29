const { validationResult } = require('express-validator');
const NotificationService = require('../services/notificationService');
const { supabaseAdmin } = require('../db/config');
const fcmService = require('../services/fcmService');

class NotificationController {
  async getNotifications(req, res) {
    try {
      const userId = req.user.id;
      
      // Standardized pagination - Default limit 20, max 100
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;
      const unreadOnly = req.query.unreadOnly === 'true';

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

      // Build data query with count
      let query = supabaseAdmin
        .from('v1_notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (unreadOnly) {
        query = query.eq('read', false);
      }

      const { data, error, count } = await query;

      if (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: error.message });
      }

      if (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: error.message });
      }

      const hasMore = (offset + limit) < (count || 0);

      res.json({
        success: true,
        data: data || [],
        pagination: {
          limit,
          offset,
          count: (data || []).length,
          total: count || 0,
          hasMore,
        },
      });
    } catch (error) {
      console.error('[v1/NotificationController] getNotifications error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async markAsRead(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const { error } = await supabaseAdmin
        .from('v1_notifications')
        .update({ read: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        return res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
      }

      res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
      console.error('[v1/NotificationController] markAsRead error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async getDeliveryStats(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const { data: notification, error: notifError } = await supabaseAdmin
        .from('v1_notifications')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (notifError || !notification) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      const statsResult = await NotificationService.getDeliveryStats(id);
      if (!statsResult.success) {
        return res
          .status(500)
          .json({ success: false, message: 'Failed to get delivery stats', error: statsResult.error });
      }

      res.json({ success: true, data: statsResult.stats });
    } catch (error) {
      console.error('[v1/NotificationController] getDeliveryStats error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async retryNotification(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const { data: notification, error: notifError } = await supabaseAdmin
        .from('v1_notifications')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (notifError || !notification) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      const retryResult = await NotificationService.retryNotification(id);
      if (!retryResult.success) {
        return res
          .status(400)
          .json({ success: false, message: 'Failed to retry notification', error: retryResult.error });
      }

      res.json({ success: true, message: 'Notification retry initiated', data: retryResult });
    } catch (error) {
      console.error('[v1/NotificationController] retryNotification error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async registerFCMToken(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { token, device_type = 'unknown', device_id } = req.body;

      const result = await fcmService.registerToken(userId, token, device_type, device_id);

      if (result.success) {
        return res.json({
          success: true,
          message: 'FCM token registered successfully',
          data: result.data,
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Failed to register FCM token',
        error: result.error,
      });
    } catch (error) {
      console.error('[v1/NotificationController] registerFCMToken error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async unregisterFCMToken(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { token } = req.body;

      const result = await fcmService.unregisterToken(userId, token);

      if (result.success) {
        return res.json({
          success: true,
          message: 'FCM token unregistered successfully',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Failed to unregister FCM token',
        error: result.error,
      });
    } catch (error) {
      console.error('[v1/NotificationController] unregisterFCMToken error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async getFCMTokens(req, res) {
    try {
      const userId = req.user.id;
      const result = await fcmService.getUserTokens(userId);

      if (result.success) {
        return res.json({
          success: true,
          tokens: result.tokens || [],
          count: result.tokens?.length || 0,
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Failed to get FCM tokens',
        error: result.error,
      });
    } catch (error) {
      console.error('[v1/NotificationController] getFCMTokens error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async sendTestNotification(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { title, body, data, clickAction, badge } = req.body;

      const notification = {
        title: title || 'Test Notification',
        body: body || 'This is a test notification from Stoory',
        data: data || { type: 'test' },
        clickAction: clickAction || '/',
        badge: badge || 1,
      };

      const result = await fcmService.sendNotificationToUser(userId, notification);

      if (result.success) {
        return res.json({
          success: true,
          message: 'Test notification sent',
          sent: result.sent,
          failed: result.failed,
          details: result.details,
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Failed to send test notification',
        error: result.error,
      });
    } catch (error) {
      console.error('[v1/NotificationController] sendTestNotification error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async getFCMStatus(req, res) {
    try {
      const status = {
        initialized: fcmService.initialized,
        message: fcmService.initialized
          ? 'FCM service is initialized and ready'
          : 'FCM service is not initialized. Check Firebase credentials.',
      };

      // Optionally get user's token count
      if (req.user) {
        const tokensResult = await fcmService.getUserTokens(req.user.id);
        if (tokensResult.success) {
          status.userTokens = tokensResult.tokens?.length || 0;
        }
      }

      return res.json({
        success: true,
        ...status,
      });
    } catch (error) {
      console.error('[v1/NotificationController] getFCMStatus error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async cleanupInactiveTokens(req, res) {
    try {
      // Check if user is admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Admin role required.',
        });
      }

      const daysInactive = parseInt(req.body.daysInactive, 10) || 30;
      const result = await fcmService.cleanupInactiveTokens(daysInactive);

      if (result.success) {
        return res.json({
          success: true,
          message: 'Inactive tokens cleaned up successfully',
          deleted: result.deleted,
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Failed to cleanup inactive tokens',
        error: result.error,
      });
    } catch (error) {
      console.error('[v1/NotificationController] cleanupInactiveTokens error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async deleteNotification(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      // Verify notification belongs to user
      const { data: notification, error: notifError } = await supabaseAdmin
        .from('v1_notifications')
        .select('id, user_id')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (notifError || !notification) {
        return res.status(404).json({ 
          success: false, 
          message: 'Notification not found' 
        });
      }

      // Delete the notification
      const { error } = await supabaseAdmin
        .from('v1_notifications')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to delete notification', 
          error: error.message 
        });
      }

      res.json({ 
        success: true, 
        message: 'Notification deleted successfully' 
      });
    } catch (error) {
      console.error('[v1/NotificationController] deleteNotification error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async deleteAllNotifications(req, res) {
    try {
      const userId = req.user.id;
      const { readOnly = false } = req.query; // Optional: delete only read notifications

      let query = supabaseAdmin
        .from('v1_notifications')
        .delete()
        .eq('user_id', userId);

      // If readOnly is true, only delete read notifications
      if (readOnly === 'true') {
        query = query.eq('read', true);
      }

      const { error } = await query;

      if (error) {
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to delete notifications', 
          error: error.message 
        });
      }

      res.json({ 
        success: true, 
        message: readOnly === 'true' 
          ? 'All read notifications deleted successfully' 
          : 'All notifications deleted successfully'
      });
    } catch (error) {
      console.error('[v1/NotificationController] deleteAllNotifications error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

module.exports = new NotificationController();

