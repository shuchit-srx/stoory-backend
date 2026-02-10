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
        .upsert(
          {
            user_id: userId,
            token: token,
            device_type: deviceType,
            device_id: deviceId,
            is_active: true,
            last_used_at: new Date().toISOString()
          },
          {
            onConflict: 'user_id,token'
          }
        )
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
      // Mark token as inactive instead of deleting it
      const { error } = await supabaseAdmin
        .from('fcm_tokens')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('token', token);

      if (error) {
        console.error('❌ Failed to deactivate FCM token:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ FCM token deactivated for user ${userId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error deactivating FCM token:', error);
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

      // NOTE: We no longer update last_used_at here. 
      // last_used_at should reflect the last time the user actually used the app (login/register),
      // not when we sent them a notification.

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
        // Both notification and data for compatibility
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.imageUrl
        },
        data: {
          ...notification.data,
          click_action: notification.clickAction || 'FLUTTER_NOTIFICATION_CLICK',
          // Add notification data for iOS background handling
          title: notification.title,
          body: notification.body
        },
        android: {
          // High priority for immediate delivery and banners
          priority: 'high',
          notification: {
            sound: 'default',
            defaultSound: true,
            channelId: 'stoory_notifications',
            priority: 'high',
            visibility: 'public', // Show on lock screen
            icon: 'ic_notification' // Ensure icon is set (matches Flutter default)
          }
        },
        apns: {
          headers: {
            'apns-priority': '10', // High priority for immediate delivery
            'apns-push-type': 'alert', // Alert type for banner display
            'apns-expiration': '0' // No expiration
          },
          payload: {
            aps: {
              // Use dictionary format for alert to ensure it shows as banner
              alert: {
                title: notification.title,
                body: notification.body
              },
              sound: 'default',
              badge: notification.badge || 1,
              // category: 'MESSAGE_CATEGORY', // Removed to prevent "View/Dismiss" buttons
              'mutable-content': 1,
              'interruption-level': 'active' // iOS 15+ immediate delivery
              // Do NOT set 'content-available' to avoid silent pushes
            },
            // Add custom data for iOS
            ...notification.data
          }
        },
        webpush: {
          headers: {
            Urgency: 'high'
          },
          notification: {
            icon: notification.icon || '/icon-192x192.png',
            badge: '/badge-72x72.png',
            requireInteraction: true,
            renotify: true,
            vibrate: [200, 100, 200]
          }
        }
      };

      // Send to each token individually since sendMulticast might not be available
      const successful = [];
      const failed = [];
      const failedDetails = [];

      for (let i = 0; i < tokens.length; i++) {
        try {
          const response = await admin.messaging().send({
            token: tokens[i],
            ...message
          });

          successful.push(tokens[i]);
          console.log(`✅ Successfully sent to token ${tokens[i].substring(0, 20)}...`);
        } catch (error) {
          const token = tokens[i];
          failed.push(token);
          const errorCode = error?.code || null;
          failedDetails.push({ token, errorCode, message: error?.message || 'send failed' });
          console.error(`❌ Failed to send to token ${token.substring(0, 20)}...:`, error.message, errorCode ? `(${errorCode})` : '');
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
        failedDetails,
        response
      };
    } catch (error) {
      console.error('❌ Error sending to tokens:', error);
      throw error;
    }
  }

  /**
   * Send chat message notification (only if user is not actively viewing conversation)
   */
  async sendMessageNotification(conversationId, message, senderId, receiverId, io = null) {
    try {
      // Check if receiver is actively viewing this conversation
      // If they're in the room, they'll get socket notification, skip FCM
      let shouldSkip = false;

      if (io && io.sockets && io.sockets.adapter) {
        try {
          const roomName = `room:${conversationId}`;
          const userRoom = `user_${receiverId}`;

          // Get all sockets in the user room
          const userRoomSockets = io.sockets.adapter.rooms.get(userRoom);

          if (userRoomSockets && userRoomSockets.size > 0) {
            // Check if any of user's sockets are in the conversation room
            const conversationRoom = io.sockets.adapter.rooms.get(roomName);

            if (conversationRoom && conversationRoom.size > 0) {
              // Check if any of user's sockets are in the conversation room
              for (const socketId of userRoomSockets) {
                if (conversationRoom.has(socketId)) {
                  console.log(`ℹ️ [FCM] User ${receiverId} is viewing conversation ${conversationId}, skipping FCM`);
                  shouldSkip = true;
                  break;
                }
              }
            }
          }
        } catch (adapterError) {
          console.warn('⚠️ [FCM] Error checking room membership, proceeding with FCM:', adapterError.message);
          // If we can't check, default to sending FCM (safer)
        }
      }

      if (shouldSkip) {
        return { success: true, sent: 0, failed: 0, skipped: true };
      }

      // Get sender name
      const { data: sender } = await supabaseAdmin
        .from('users')
        .select('name')
        .eq('id', senderId)
        .single();

      const senderName = sender ? sender.name : 'Someone';

      const notification = {
        title: `${senderName} sent you a message`,
        body: message.message || 'New message',
        clickAction: `/conversations/${conversationId}`, // Add deep link for chat screen
        data: {
          type: 'message',
          conversationId: conversationId, // REQUIRED per spec
          conversation_id: conversationId, // Fallback
          entity_id: conversationId, // Generic fallback
          senderId: senderId, // REQUIRED per spec
          sender_id: senderId, // Fallback
          receiver_id: receiverId,
          message_id: message.id
        }
      };

      return await this.sendNotificationToUser(receiverId, notification);
    } catch (error) {
      console.error('❌ Error sending message notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send campaign notification
   */
  async sendCampaignNotification(campaignId, title, body, receiverId) {
    try {
      const notification = {
        title: title,
        body: body,
        data: {
          type: 'campaign',
          campaignId: campaignId, // REQUIRED per spec
          campaign_id: campaignId, // Fallback
          entity_id: campaignId // Generic fallback
        }
      };

      return await this.sendNotificationToUser(receiverId, notification);
    } catch (error) {
      console.error('❌ Error sending campaign notification:', error);
      return { success: false, error: error.message };
    }
  }



  /**
   * Send request notification (when influencer applies)
   */
  async sendRequestNotification(receiverId, title, body, imageUrl, data) {
    try {
      const notification = {
        title: title,
        body: body,
        imageUrl: imageUrl,
        data: {
          type: 'request',
          ...data
        }
      };

      return await this.sendNotificationToUser(receiverId, notification);
    } catch (error) {
      console.error('❌ Error sending request notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send flow state notification (only if user is offline)
   */
  async sendFlowStateNotification(conversationId, userId, flowState, customMessage = null) {
    try {
      // Check if user is online - if online, skip FCM (they'll get socket notification)
      const notificationService = require('./notificationService');
      if (notificationService.isUserOnline(userId)) {
        console.log(`ℹ️ [FCM] Skipping flow state FCM for online user ${userId}`);
        return { success: true, sent: 0, failed: 0, skipped: true };
      }

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

      // Delete old tokens instead of flipping is_active
      const { error } = await supabaseAdmin
        .from('fcm_tokens')
        .delete()
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
