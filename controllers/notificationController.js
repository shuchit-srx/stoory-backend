const notificationService = require('../services/notificationService');

class NotificationController {
  /**
   * Get user notifications
   */
  async getNotifications(req, res) {
    try {
      const userId = req.user.id;
      const {
        page = 1,
        limit = 20,
        status,
        type,
        unread_only = false,
        mark_read_on_view = false
      } = req.query;

      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        type,
        unread_only: unread_only === 'true'
      };

      // If mark_read_on_view is true, mark all unread notifications as read when fetching
      if (mark_read_on_view === 'true') {
        const markResult = await notificationService.markAllAsRead(userId);
        if (markResult.success) {
          // Emit realtime update
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${userId}`).emit('notifications_all_read', {
              user_id: userId
            });
            io.to(`user_${userId}`).emit('unread_count_updated', {
              count: 0
            });
          }
        }
      }

      const result = await notificationService.getUserNotifications(userId, options);

      if (result.success) {
        // Get unread count for response
        const countResult = await notificationService.getUnreadCount(userId);
        const unreadCount = countResult.success ? countResult.count : 0;

        res.json({
          success: true,
          notifications: result.notifications,
          pagination: result.pagination,
          unread_count: unreadCount,
          marked_read_on_view: mark_read_on_view === 'true'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to fetch notifications',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in getNotifications:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(req, res) {
    try {
      const userId = req.user.id;

      const result = await notificationService.getUnreadCount(userId);

      if (result.success) {
        res.json({
          success: true,
          count: result.count
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to get unread count',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in getUnreadCount:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(req, res) {
    try {
      const userId = req.user.id;
      const { notificationId } = req.params;

      const result = await notificationService.markAsRead(notificationId, userId);

      if (result.success) {
        // Get updated unread count
        const countResult = await notificationService.getUnreadCount(userId);
        const unreadCount = countResult.success ? countResult.count : 0;

        // Emit realtime updates
        const io = req.app.get('io');
        if (io) {
          io.to(`user_${userId}`).emit('notification_updated', {
            id: notificationId,
            read_at: result.notification.read_at,
            status: 'delivered'
          });

          io.to(`user_${userId}`).emit('unread_count_updated', {
            count: unreadCount
          });
        }

        res.json({
          success: true,
          data: {
            message: 'Notification marked as read',
            notification: result.notification,
            unread_count: unreadCount
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to mark notification as read',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in markAsRead:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(req, res) {
    try {
      const userId = req.user.id;

      const result = await notificationService.markAllAsRead(userId);

      if (result.success) {
        // Emit realtime updates
        const io = req.app.get('io');
        if (io) {
          io.to(`user_${userId}`).emit('notifications_all_read', {
            user_id: userId
          });

          io.to(`user_${userId}`).emit('unread_count_updated', {
            count: 0
          });
        }

        res.json({
          success: true,
          data: {
            message: 'All notifications marked as read',
            unread_count: 0
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to mark all notifications as read',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in markAllAsRead:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Clean up expired notifications (admin only)
   */
  async cleanupExpired(req, res) {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Admin role required.'
        });
      }

      const result = await notificationService.cleanupExpiredNotifications();

      if (result.success) {
        res.json({
          success: true,
          message: 'Expired notifications cleaned up successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to cleanup expired notifications',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in cleanupExpired:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Delete a single notification
   */
  async deleteNotification(req, res) {
    try {
      const userId = req.user.id;
      const { notificationId } = req.params;

      const result = await notificationService.deleteNotification(notificationId, userId);
      if (result.success) {
        // Get updated unread count after deletion
        const countResult = await notificationService.getUnreadCount(userId);
        const unreadCount = countResult.success ? countResult.count : 0;

        // Emit realtime updates
        const io = req.app.get('io');
        if (io) {
          io.to(`user_${userId}`).emit('notification_deleted', {
            id: notificationId
          });

          io.to(`user_${userId}`).emit('unread_count_updated', {
            count: unreadCount
          });
        }

        return res.json({
          success: true,
          data: {
            message: 'Notification deleted',
            unread_count: unreadCount
          }
        });
      }
      return res.status(400).json({ success: false, error: result.error });
    } catch (error) {
      console.error('❌ Error in deleteNotification:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Clear all notifications for current user
   */
  async clearAll(req, res) {
    try {
      const userId = req.user.id;
      const result = await notificationService.clearAllNotifications(userId);
      if (result.success) {
        // Emit realtime updates
        const io = req.app.get('io');
        if (io) {
          io.to(`user_${userId}`).emit('notifications_cleared', {
            user_id: userId
          });

          io.to(`user_${userId}`).emit('unread_count_updated', {
            count: 0
          });
        }

        return res.json({
          success: true,
          data: {
            message: 'All notifications cleared',
            unread_count: 0
          }
        });
      }
      return res.status(400).json({ success: false, error: result.error });
    } catch (error) {
      console.error('❌ Error in clearAll:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Register device token
   */
  async registerDevice(req, res) {
    try {
      const userId = req.user.id;
      const { token, platform } = req.body;

      if (!token) {
        console.warn('⚠️ [REGISTER_DEVICE] Token missing in request body:', JSON.stringify(req.body));
        return res.status(400).json({
          success: false,
          message: 'Token is required'
        });
      }

      const fcmService = require('../services/fcmService');
      const result = await fcmService.registerToken(userId, token, platform || 'unknown');

      if (result.success) {
        return res.json({
          success: true,
          message: 'Device registered successfully'
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'Failed to register device',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Error in registerDevice:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

module.exports = new NotificationController();
