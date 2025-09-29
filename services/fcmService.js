const admin = require('firebase-admin');
const { supabaseAdmin } = require('../supabase/client');

class FCMService {
  constructor() {
    this.initialized = false;
    this.initializeFirebase();
  }

  /**
   * Initialize Firebase Admin SDK
   */
  initializeFirebase() {
    try {
      // Check if Firebase is already initialized
      if (admin.apps.length > 0) {
        this.app = admin.app();
        this.initialized = true;
        console.log('✅ Firebase Admin SDK already initialized');
        return;
      }

      // Initialize Firebase Admin SDK
      const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
      };

      if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
        console.warn('⚠️ Firebase credentials not found. FCM notifications will be disabled.');
        return;
      }

      this.app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID
      });

      this.initialized = true;
      console.log('✅ Firebase Admin SDK initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase Admin SDK:', error);
      this.initialized = false;
    }
  }

  /**
   * Register FCM token for a user
   */
  async registerToken(userId, token, deviceType = 'web', deviceId = null) {
    try {
      if (!this.initialized) {
        return { success: false, error: 'FCM service not initialized' };
      }

      // Upsert FCM token
      const { data, error } = await supabaseAdmin
        .from('fcm_tokens')
        .upsert({
          user_id: userId,
          token: token,
          device_type: deviceType,
          device_id: deviceId,
          is_active: true,
          last_used_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,token'
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Failed to register FCM token:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ FCM token registered for user ${userId}`);
      return { success: true, data };
    } catch (error) {
      console.error('❌ Error registering FCM token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unregister FCM token
   */
  async unregisterToken(userId, token) {
    try {
      const { error } = await supabaseAdmin
        .from('fcm_tokens')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('token', token);

      if (error) {
        console.error('❌ Failed to unregister FCM token:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ FCM token unregistered for user ${userId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error unregistering FCM token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active FCM tokens for a user
   */
  async getUserTokens(userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('fcm_tokens')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('last_used_at', { ascending: false });

      if (error) {
        console.error('❌ Failed to get user FCM tokens:', error);
        return { success: false, error: error.message };
      }

      return { success: true, tokens: data };
    } catch (error) {
      console.error('❌ Error getting user FCM tokens:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to a single user
   */
  async sendNotificationToUser(userId, notification) {
    try {
      if (!this.initialized) {
        console.warn('⚠️ FCM service not initialized, skipping push notification');
        return { success: false, error: 'FCM service not initialized' };
      }

      const tokensResult = await this.getUserTokens(userId);
      if (!tokensResult.success || !tokensResult.tokens.length) {
        console.log(`ℹ️ No active FCM tokens found for user ${userId}`);
        return { success: true, sent: 0, failed: 0 };
      }

      const tokens = tokensResult.tokens.map(t => t.token);
      const results = await this.sendToTokens(tokens, notification);

      // Update last_used_at for successful tokens
      if (results.successful.length > 0) {
        await supabaseAdmin
          .from('fcm_tokens')
          .update({ last_used_at: new Date().toISOString() })
          .in('token', results.successful);
      }

      // Deactivate failed tokens
      if (results.failed.length > 0) {
        await supabaseAdmin
          .from('fcm_tokens')
          .update({ is_active: false })
          .in('token', results.failed);
      }

      return {
        success: true,
        sent: results.successful.length,
        failed: results.failed.length,
        details: results
      };
    } catch (error) {
      console.error('❌ Error sending notification to user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to multiple users
   */
  async sendNotificationToUsers(userIds, notification) {
    try {
      if (!this.initialized) {
        console.warn('⚠️ FCM service not initialized, skipping push notifications');
        return { success: false, error: 'FCM service not initialized' };
      }

      let totalSent = 0;
      let totalFailed = 0;
      const results = [];

      for (const userId of userIds) {
        const result = await this.sendNotificationToUser(userId, notification);
        if (result.success) {
          totalSent += result.sent;
          totalFailed += result.failed;
        }
        results.push({ userId, ...result });
      }

      return {
        success: true,
        sent: totalSent,
        failed: totalFailed,
        details: results
      };
    } catch (error) {
      console.error('❌ Error sending notifications to users:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to specific FCM tokens
   */
  async sendToTokens(tokens, notification) {
    try {
      if (!this.initialized) {
        throw new Error('FCM service not initialized');
      }

      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.imageUrl
        },
        data: {
          ...notification.data,
          click_action: notification.clickAction || 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'stoory_notifications',
            priority: 'high',
            defaultSound: true
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: notification.badge || 1,
              category: 'MESSAGE_CATEGORY'
            }
          }
        },
        webpush: {
          notification: {
            icon: notification.icon || '/icon-192x192.png',
            badge: '/badge-72x72.png',
            requireInteraction: true
          }
        }
      };

      // Send to each token individually since sendMulticast might not be available
      const successful = [];
      const failed = [];

      for (let i = 0; i < tokens.length; i++) {
        try {
          const response = await admin.messaging().send({
            token: tokens[i],
            ...message
          });
          
          successful.push(tokens[i]);
          console.log(`✅ Successfully sent to token ${tokens[i].substring(0, 20)}...`);
        } catch (error) {
          failed.push(tokens[i]);
          console.error(`❌ Failed to send to token ${tokens[i].substring(0, 20)}...:`, error.message);
        }
      }

      const response = {
        responses: tokens.map((token, idx) => ({
          success: successful.includes(token),
          error: failed.includes(token) ? new Error('Send failed') : null
        }))
      };

      return {
        success: true,
        successful,
        failed,
        response
      };
    } catch (error) {
      console.error('❌ Error sending to tokens:', error);
      throw error;
    }
  }

  /**
   * Send message notification
   */
  async sendMessageNotification(conversationId, message, senderId, receiverId) {
    try {
      // Fetch sender's name
      let senderName = 'Someone';
      try {
        const { data: sender, error } = await supabaseAdmin
          .from('users')
          .select('name')
          .eq('id', senderId)
          .eq('is_deleted', false)
          .single();

        if (!error && sender && sender.name) {
          senderName = sender.name;
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch sender name for notification:', error.message);
      }

      const notification = {
        title: `${senderName} sent you a message`,
        body: message.message.length > 100 
          ? message.message.substring(0, 100) + '...' 
          : message.message,
        data: {
          type: 'message',
          conversation_id: conversationId,
          message_id: message.id,
          sender_id: senderId,
          receiver_id: receiverId
        },
        clickAction: `/conversations/${conversationId}`
      };

      return await this.sendNotificationToUser(receiverId, notification);
    } catch (error) {
      console.error('❌ Error sending message notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send flow state notification
   */
  async sendFlowStateNotification(conversationId, userId, flowState, customMessage = null) {
    try {
      const stateMessages = {
        'influencer_responding': 'You have a new connection request',
        'brand_owner_details': 'Please provide project details',
        'influencer_reviewing': 'Please review the project requirements',
        'brand_owner_pricing': 'Please set your price offer',
        'influencer_price_response': 'Please respond to the price offer',
        'payment_pending': 'Payment is required to continue',
        'payment_completed': 'Payment completed! You can start working',
        'work_in_progress': 'Work has started',
        'work_submitted': 'Work has been submitted for review',
        'work_approved': 'Work has been approved!',
        'real_time': 'Real-time chat is now available'
      };

      const message = customMessage || stateMessages[flowState] || 'Conversation state updated';

      const notification = {
        title: 'Conversation Update',
        body: message,
        data: {
          type: 'flow_state',
          conversation_id: conversationId,
          flow_state: flowState
        },
        clickAction: `/conversations/${conversationId}`
      };

      return await this.sendNotificationToUser(userId, notification);
    } catch (error) {
      console.error('❌ Error sending flow state notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send global notification for conversation list updates
   */
  async sendGlobalNotification(userId, notificationData) {
    try {
      const notification = {
        title: notificationData.title || 'New Update',
        body: notificationData.body || 'You have a new update',
        data: {
          type: 'global_update',
          ...notificationData.data
        },
        clickAction: notificationData.clickAction || '/conversations'
      };

      return await this.sendNotificationToUser(userId, notification);
    } catch (error) {
      console.error('❌ Error sending global notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up inactive tokens (older than 30 days)
   */
  async cleanupInactiveTokens() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { error } = await supabaseAdmin
        .from('fcm_tokens')
        .update({ is_active: false })
        .eq('is_active', true)
        .lt('last_used_at', thirtyDaysAgo.toISOString());

      if (error) {
        console.error('❌ Failed to cleanup inactive tokens:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Cleaned up inactive FCM tokens');
      return { success: true };
    } catch (error) {
      console.error('❌ Error cleaning up inactive tokens:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new FCMService();
