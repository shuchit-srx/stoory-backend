const admin = require('firebase-admin');
const { supabaseAdmin } = require('../db/config');

class FCMService {
  constructor() {
    this.initialized = false;
    this.initializeFirebase();
  }

  initializeFirebase() {
    try {
      if (admin.apps.length > 0) {
        this.app = admin.app();
        this.initialized = true;
        console.log('✅ [v1/FCM] Firebase Admin already initialized');
        return;
      }

      const serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: process.env.FIREBASE_CLIENT_EMAIL
          ? `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
          : undefined,
      };

      if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
        console.warn('⚠️ [v1/FCM] Firebase credentials missing. FCM disabled.');
        return;
      }

      this.app = admin.initializeApp(
        {
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID,
        },
        'v1-fcm',
      );

      this.initialized = true;
      console.log('✅ [v1/FCM] Firebase Admin initialized');
    } catch (error) {
      console.error('❌ [v1/FCM] Init failed:', error);
      this.initialized = false;
    }
  }

  async registerToken(userId, token, deviceType = 'unknown', deviceId = null) {
    try {
      if (!this.initialized) {
        return { success: false, error: 'FCM not initialized' };
      }

      // Check if token already exists for this user (token refresh scenario)
      const { data: existingToken } = await supabaseAdmin
        .from('v1_fcm_tokens')
        .select('token, user_id')
        .eq('user_id', userId)
        .eq('token', token)
        .maybeSingle();

      const { data, error } = await supabaseAdmin
        .from('v1_fcm_tokens')
        .upsert(
          {
            user_id: userId,
            token,
            device_type: deviceType,
            device_id: deviceId,
            is_active: true,
            last_used_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,token' },
        )
        .select()
        .single();

      if (error) {
        console.error('❌ [v1/FCM] Register token failed:', error);
        return { success: false, error: error.message };
      }

      // Deactivate other tokens (single active device policy)
      const { error: deactivateError } = await supabaseAdmin
        .from('v1_fcm_tokens')
        .update({ is_active: false })
        .eq('user_id', userId)
        .neq('token', token);

      if (deactivateError) {
        console.warn('⚠️ [v1/FCM] Deactivate old tokens failed:', deactivateError);
      }

      // If token was updated (not new), log it for monitoring
      if (existingToken) {
        console.log(`✅ [v1/FCM] Token updated for user ${userId}`);
      }

      return { success: true, data };
    } catch (error) {
      console.error('❌ [v1/FCM] Register token error:', error);
      return { success: false, error: error.message };
    }
  }

  async unregisterToken(userId, token) {
    try {
      const { error } = await supabaseAdmin
        .from('v1_fcm_tokens')
        .delete()
        .eq('user_id', userId)
        .eq('token', token);

      if (error) {
        console.error('❌ [v1/FCM] Unregister failed:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('❌ [v1/FCM] Unregister error:', error);
      return { success: false, error: error.message };
    }
  }

  async getUserTokens(userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('v1_fcm_tokens')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('last_used_at', { ascending: false });

      if (error) {
        console.error('❌ [v1/FCM] Get tokens failed:', error);
        return { success: false, error: error.message };
      }

      return { success: true, tokens: data || [] };
    } catch (error) {
      console.error('❌ [v1/FCM] Get tokens error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendNotificationToUser(userId, notification) {
    try {
      if (!this.initialized) {
        return { success: false, error: 'FCM not initialized' };
      }

      const tokensResult = await this.getUserTokens(userId);
      if (!tokensResult.success || !tokensResult.tokens.length) {
        return { success: true, sent: 0, failed: 0 };
      }

      const tokens = tokensResult.tokens.map((t) => t.token);
      const results = await this.sendToTokens(tokens, notification);

      return {
        success: true,
        sent: results.successful.length,
        failed: results.failed.length,
        details: results,
      };
    } catch (error) {
      console.error('❌ [v1/FCM] Send to user error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendToTokens(tokens, notification) {
    if (!this.initialized) {
      throw new Error('FCM not initialized');
    }

    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl,
      },
      data: {
        ...notification.data,
        click_action: notification.clickAction || 'FLUTTER_NOTIFICATION_CLICK',
        title: notification.title,
        body: notification.body,
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          defaultSound: true,
          channelId: 'stoory_notifications',
          priority: 'high',
          visibility: 'public',
          icon: 'ic_notification',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          'apns-expiration': '0',
        },
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            sound: 'default',
            badge: notification.badge || 1,
            'mutable-content': 1,
            'interruption-level': 'active',
          },
          ...notification.data,
        },
      },
    };

    const successful = [];
    const failed = [];
    const failedDetails = [];

    // Use batch sending for multiple tokens (more efficient)
    if (tokens.length === 0) {
      return { successful, failed, failedDetails };
    }

    if (tokens.length === 1) {
      // Single token - use regular send
      try {
        await this.app.messaging().send({
          token: tokens[0],
          ...message,
        });
        successful.push(tokens[0]);
      } catch (error) {
        failed.push(tokens[0]);
        failedDetails.push({
          token: tokens[0],
          errorCode: error?.code || null,
          message: error?.message || 'send failed',
        });

        if (
          error?.code === 'messaging/invalid-registration-token' ||
          error?.code === 'messaging/registration-token-not-registered'
        ) {
          await this.removeInvalidToken(tokens[0]);
        }
      }
    } else {
      // Multiple tokens - use multicast for batch sending
      try {
        const multicastMessage = {
          ...message,
          tokens: tokens,
        };

        const response = await this.app.messaging().sendMulticast(multicastMessage);

        // Process responses
        response.responses.forEach((result, index) => {
          if (result.success) {
            successful.push(tokens[index]);
          } else {
            failed.push(tokens[index]);
            failedDetails.push({
              token: tokens[index],
              errorCode: result.error?.code || null,
              message: result.error?.message || 'send failed',
            });

            // Remove invalid tokens
            if (
              result.error?.code === 'messaging/invalid-registration-token' ||
              result.error?.code === 'messaging/registration-token-not-registered'
            ) {
              this.removeInvalidToken(tokens[index]);
            }
          }
        });
      } catch (error) {
        // If multicast fails, fallback to individual sends
        console.warn('[v1/FCM] Multicast failed, falling back to individual sends:', error.message);
        
        for (let i = 0; i < tokens.length; i++) {
          try {
            await this.app.messaging().send({
              token: tokens[i],
              ...message,
            });
            successful.push(tokens[i]);
          } catch (err) {
            failed.push(tokens[i]);
            failedDetails.push({
              token: tokens[i],
              errorCode: err?.code || null,
              message: err?.message || 'send failed',
            });

            if (
              err?.code === 'messaging/invalid-registration-token' ||
              err?.code === 'messaging/registration-token-not-registered'
            ) {
              await this.removeInvalidToken(tokens[i]);
            }
          }
        }
      }
    }

    return { successful, failed, failedDetails };
  }

  async removeInvalidToken(token) {
    try {
      const { error } = await supabaseAdmin.from('v1_fcm_tokens').delete().eq('token', token);
      if (error) {
        console.error('❌ [v1/FCM] Remove invalid token failed:', error);
      }
    } catch (error) {
      console.error('❌ [v1/FCM] Remove invalid token error:', error);
    }
  }

  async cleanupInactiveTokens(daysInactive = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

      // First, get count of tokens to be deleted
      const { count, error: countError } = await supabaseAdmin
        .from('v1_fcm_tokens')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', false)
        .lt('last_used_at', cutoffDate.toISOString());

      if (countError) {
        console.error('❌ [v1/FCM] Cleanup count failed:', countError);
        return { success: false, error: countError.message };
      }

      // Delete the inactive tokens
      const { error } = await supabaseAdmin
        .from('v1_fcm_tokens')
        .delete()
        .eq('is_active', false)
        .lt('last_used_at', cutoffDate.toISOString());

      if (error) {
        console.error('❌ [v1/FCM] Cleanup failed:', error);
        return { success: false, error: error.message };
      }

      const deletedCount = count || 0;
      console.log(`✅ [v1/FCM] Cleaned up ${deletedCount} inactive tokens older than ${daysInactive} days`);

      return { success: true, deleted: deletedCount };
    } catch (error) {
      console.error('❌ [v1/FCM] Cleanup error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new FCMService();

