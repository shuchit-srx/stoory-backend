const { supabaseAdmin } = require('../db/config');
const fcmService = require('./fcmService');

class NotificationService {
  constructor() {
    // Notification batching
    this.notificationQueue = new Map(); // Map<userId, Array<notificationData>>
    this.batchTimer = null;
    this.BATCH_WINDOW = 5000; // 5 seconds
    this.MAX_BATCH_SIZE = 10; // Max notifications per batch
    
    // Retry queue with exponential backoff
    this.retryQueue = new Map(); // Map<notificationId, {attempts, nextRetry, data}>
    this.retryTimer = null;
    this.MAX_RETRIES = 5;
    this.INITIAL_RETRY_DELAY = 2000; // 2 seconds
    this.MAX_RETRY_DELAY = 30000; // 30 seconds

    // In-memory duplicate cache
    this.duplicateCache = new Map(); // Map<key, timestamp>
    this.DUPLICATE_CACHE_TTL = 30000; // 30 seconds
    this.startDuplicateCacheCleanup();
  }

  startDuplicateCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this.duplicateCache.entries()) {
        if (now - timestamp > this.DUPLICATE_CACHE_TTL) {
          this.duplicateCache.delete(key);
        }
      }
    }, this.DUPLICATE_CACHE_TTL);
  }

  async logDeliveryAttempt(notificationId, method, success, details = {}) {
    Promise.resolve().then(async () => {
      try {
        await supabaseAdmin.from('v1_notification_delivery_attempts').insert({
          notification_id: notificationId,
          method,
          success,
          details,
          attempted_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[v1/Notification] Failed to log delivery attempt:', err);
      }
    });
  }

  async sendFCMNotification(userId, notificationData) {
    try {
      if (!fcmService.initialized) {
        console.warn(`[v1/Notification] FCM service not initialized, cannot send notification to user ${userId}`);
        return { 
          success: false, 
          error: 'FCM service not initialized', 
          sent: 0, 
          failed: 0,
          reason: 'service_not_initialized'
        };
      }

      const result = await fcmService.sendNotificationToUser(userId, {
        title: notificationData.title,
        body: notificationData.body,
        clickAction: notificationData.clickAction || '/',
        data: {
          type: notificationData.type,
          ...notificationData.data,
        },
        badge: notificationData.badge || 1,
      });

      if (result.success && result.sent === 0 && !result.reason) {
        result.reason = 'no_tokens';
      }

      if (!result.success) {
        console.error(`[v1/Notification] FCM send failed for user ${userId}:`, {
          error: result.error,
          reason: result.reason,
          sent: result.sent,
          failed: result.failed
        });
      } else if (result.sent === 0) {
        console.log(`[v1/Notification] FCM send succeeded but no tokens for user ${userId}`);
      } else {
        console.log(`[v1/Notification] FCM send succeeded for user ${userId}: ${result.sent} sent, ${result.failed} failed`);
      }

      return result;
    } catch (error) {
      console.error(`[v1/Notification] FCM send error for user ${userId}:`, error);
      return { 
        success: false, 
        error: error.message, 
        sent: 0, 
        failed: 0,
        reason: 'exception'
      };
    }
  }

  async sendNotification(userId, notificationData, notificationId = null) {
    let fcmResult = null;
    
    if (!fcmService.initialized) {
      console.warn(`[v1/Notification] FCM not initialized, cannot send push notification to user ${userId}`);
      if (notificationId) {
        this.logDeliveryAttempt(notificationId, 'fcm', false, {
          error: 'FCM not initialized',
          reason: 'service_not_initialized'
        });
      }
    } else {
      fcmResult = await this.sendFCMNotification(userId, notificationData);
      
      if (notificationId) {
        const fcmSuccess = fcmResult.success && fcmResult.sent > 0;
        const fcmHasTokens = fcmResult.success && fcmResult.sent === 0 && fcmResult.reason === 'no_tokens' && !fcmResult.error;
        
        this.logDeliveryAttempt(notificationId, 'fcm', fcmSuccess || fcmHasTokens, {
          sent: fcmResult.sent || 0,
          failed: fcmResult.failed || 0,
          error: fcmResult.error || null,
          reason: fcmResult.reason || null,
          details: fcmResult.details || null,
          hasTokens: fcmHasTokens,
        });
        
        if (!fcmSuccess && !fcmHasTokens) {
          console.error(`[v1/Notification] FCM delivery failed for user ${userId}, notification ${notificationId}:`, {
            error: fcmResult.error,
            reason: fcmResult.reason,
            sent: fcmResult.sent,
            failed: fcmResult.failed
          });
        } else if (fcmHasTokens) {
          console.log(`[v1/Notification] FCM skipped for user ${userId} - no active tokens`);
        }
      }
    }
    
    // Fix: Set method based on whether FCM was attempted, not just success
    // This ensures delivery_method is 'fcm' when FCM is initialized and attempted,
    // even if no tokens were sent or delivery failed
    const success = (fcmResult?.success && fcmResult.sent > 0);
    const method = fcmService.initialized ? 'fcm' : 'none';
    
    return { 
      success, 
      method, 
      fcmResult: fcmResult || null,
    };
  }

  generateDuplicateKey(notificationData) {
    const { userId, type, data } = notificationData;
    
    if (type === 'CHAT_MESSAGE' && data?.applicationId && data?.senderId) {
      return `${userId}_${type}_${data.applicationId}_${data.senderId}`;
    }
    
    if (['APPLICATION_ACCEPTED', 'APPLICATION_CREATED', 'SCRIPT_SUBMITTED', 'SCRIPT_REVIEW', 
         'WORK_SUBMITTED', 'WORK_REVIEW', 'MOU_ACCEPTED_BY_BRAND', 'MOU_ACCEPTED_BY_INFLUENCER',
         'MOU_FULLY_ACCEPTED', 'PAYOUT_RELEASED', 'PAYMENT_COMPLETED', 'CAMPAIGN_COMPLETED'].includes(type) && 
        data?.applicationId) {
      return `${userId}_${type}_${data.applicationId}`;
    }
    
    return `${userId}_${type}_${JSON.stringify(data || {})}`;
  }

  async storeNotification(notificationData) {
    try {
      const cacheKey = this.generateDuplicateKey(notificationData);
      const cached = this.duplicateCache.get(cacheKey);
      
      if (cached && (Date.now() - cached) < this.DUPLICATE_CACHE_TTL) {
        console.log(`[v1/Notification] Duplicate detected in cache for user ${notificationData.userId}, type ${notificationData.type}`);
        return { success: true, notification: { id: 'cached' }, duplicate: true };
      }
      
      const timeWindow = 30; // 30 seconds window for duplicate detection
      const timeWindowAgo = new Date(Date.now() - timeWindow * 1000).toISOString();
      
      let existingQuery = supabaseAdmin
        .from('v1_notifications')
        .select('id')
        .eq('user_id', notificationData.userId)
        .eq('type', notificationData.type)
        .gte('created_at', timeWindowAgo)
        .limit(1);
      
      if (notificationData.type === 'CHAT_MESSAGE' && notificationData.data?.applicationId && notificationData.data?.senderId) {
        existingQuery = existingQuery
          .eq('data->>applicationId', notificationData.data.applicationId)
          .eq('data->>senderId', notificationData.data.senderId);
      } else if (['APPLICATION_ACCEPTED', 'APPLICATION_CREATED', 'SCRIPT_SUBMITTED', 'SCRIPT_REVIEW', 
                  'WORK_SUBMITTED', 'WORK_REVIEW', 'MOU_ACCEPTED_BY_BRAND', 'MOU_ACCEPTED_BY_INFLUENCER',
                  'MOU_FULLY_ACCEPTED', 'PAYOUT_RELEASED', 'PAYMENT_COMPLETED', 'CAMPAIGN_COMPLETED'].includes(notificationData.type) && 
                 notificationData.data?.applicationId) {
        existingQuery = existingQuery.eq('data->>applicationId', notificationData.data.applicationId);
      }
      
      const { data: existing } = await existingQuery.maybeSingle();
      
      if (existing) {
        console.log(`[v1/Notification] Duplicate detected in database for user ${notificationData.userId}, type ${notificationData.type}, notification ${existing.id}`);
        this.duplicateCache.set(cacheKey, Date.now());
        return { success: true, notification: existing, duplicate: true };
      }
      
      this.duplicateCache.set(cacheKey, Date.now());
      
      const { data, error } = await supabaseAdmin
        .from('v1_notifications')
        .insert({
          user_id: notificationData.userId,
          type: notificationData.type,
          title: notificationData.title,
          body: notificationData.body,
          data: notificationData.data || {},
          read: false,
          delivery_status: 'PENDING',
        })
        .select()
        .single();
      
      if (error) {
        console.error('[v1/Notification] Store failed:', error);
        return { success: false, error: error.message };
      }
      
      return { success: true, notification: data };
    } catch (error) {
      console.error('[v1/Notification] Store error:', error);
      return { success: false, error: error.message };
    }
  }

  async updateNotificationStatus(notificationId, status, method = null) {
    try {
      const updateData = {
        delivery_status: status,
      };
      
      if (method) {
        updateData.delivery_method = method;
      }
      
      Promise.resolve().then(async () => {
        await supabaseAdmin
          .from('v1_notifications')
          .update(updateData)
          .eq('id', notificationId);
      });
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendAndStoreNotification(userId, notificationData) {
    console.log(`[v1/Notification] Attempting to send notification to user ${userId}, type: ${notificationData.type}`);
    
    const shouldBatch = this.shouldBatchNotification(notificationData.type);
    
    if (shouldBatch) {
      return await this.batchNotification(userId, notificationData);
    }

    const storeResult = await this.storeNotification({ ...notificationData, userId });
    if (!storeResult.success) {
      console.error(`[v1/Notification] Failed to store notification for user ${userId}:`, storeResult.error);
      return { stored: false, sent: false, error: storeResult.error };
    }

    if (storeResult.duplicate) {
      console.log(`[v1/Notification] Duplicate notification detected for user ${userId}, type: ${notificationData.type}, skipping delivery`);
      return {
        stored: true,
        sent: false,
        duplicate: true,
        notification: storeResult.notification,
        skipped: 'duplicate_detected',
      };
    }

    const notificationId = storeResult.notification.id;
    const sendResult = await this.sendNotification(userId, notificationData, notificationId);

    if (sendResult.success) {
      this.updateNotificationStatus(notificationId, 'DELIVERED', sendResult.method);
    } else {
      this.updateNotificationStatus(notificationId, 'FAILED', sendResult.method);
      
      const fcmFailed = sendResult.fcmResult && (
        !sendResult.fcmResult.success || 
        (sendResult.fcmResult.error && sendResult.fcmResult.reason !== 'no_tokens')
      );
      
      if (fcmFailed) {
        await this.scheduleRetry(notificationId, {
          userId,
          notificationData,
          attempts: 0
        });
      }
    }

    return {
      stored: true,
      sent: sendResult.success,
      method: sendResult.method,
      notification: storeResult.notification,
    };
  }

  shouldBatchNotification(type) {
    return ['CHAT_MESSAGE', 'APPLICATION_CREATED'].includes(type);
  }

  async batchNotification(userId, notificationData) {
    if (!this.notificationQueue.has(userId)) {
      this.notificationQueue.set(userId, []);
    }
    this.notificationQueue.get(userId).push(notificationData);
    
    Promise.resolve().then(async () => {
      try {
        if (!this.batchTimer) {
          this.batchTimer = setTimeout(async () => {
            try {
              await this.flushAllBatches();
            } catch (error) {
              console.error('[v1/Notification] Error flushing batches:', error);
              this.batchTimer = null;
            }
          }, this.BATCH_WINDOW);
        }
        
        const userQueue = this.notificationQueue.get(userId);
        if (userQueue && userQueue.length >= this.MAX_BATCH_SIZE) {
          this.flushBatchForUser(userId).catch(err => {
            console.error(`[v1/Notification] Error flushing batch for user ${userId}:`, err);
          });
        }
      } catch (error) {
        console.error('[v1/Notification] Error in batchNotification:', error);
      }
    });
    
    return { stored: true, sent: true, batched: true };
  }

  async flushBatchForUser(userId) {
    const queue = this.notificationQueue.get(userId);
    if (!queue || queue.length === 0) return;
    
    this.notificationQueue.delete(userId);
    
    try {
      const batchedData = this.createBatchedNotification(queue);
      if (!batchedData) return;
      
      const storeResult = await this.storeNotification({ ...batchedData, userId });
      if (!storeResult.success) {
        if (!this.notificationQueue.has(userId)) {
          this.notificationQueue.set(userId, []);
        }
        this.notificationQueue.get(userId).push(...queue);
        return;
      }
      
      const notificationId = storeResult.notification.id;
      const sendResult = await this.sendNotification(userId, batchedData, notificationId);
      
      if (sendResult.success) {
        this.updateNotificationStatus(notificationId, 'DELIVERED', sendResult.method);
      } else {
        this.updateNotificationStatus(notificationId, 'FAILED', sendResult.method);
        
        const fcmFailed = sendResult.fcmResult && (
          !sendResult.fcmResult.success || 
          (sendResult.fcmResult.error && sendResult.fcmResult.reason !== 'no_tokens')
        );
        
        if (fcmFailed) {
          await this.scheduleRetry(notificationId, {
            userId,
            notificationData: batchedData,
            attempts: 0
          });
        }
      }
    } catch (error) {
      console.error(`[v1/Notification] Error flushing batch for user ${userId}:`, error);
      if (!this.notificationQueue.has(userId)) {
        this.notificationQueue.set(userId, []);
      }
      this.notificationQueue.get(userId).push(...queue);
    }
  }

  async flushAllBatches() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    const userIds = Array.from(this.notificationQueue.keys());
    for (const userId of userIds) {
      try {
        await this.flushBatchForUser(userId);
      } catch (error) {
        console.error(`[v1/Notification] Error flushing batch for user ${userId}:`, error);
      }
    }
  }

  createBatchedNotification(notifications) {
    if (notifications.length === 0) {
      return null;
    }

    const firstNotification = notifications[0];
    const type = firstNotification.type;

    if (type === 'CHAT_MESSAGE') {
      const count = notifications.length;
      return {
        type: 'CHAT_MESSAGE',
        title: count === 1 ? 'New Message' : `${count} New Messages`,
        body: count === 1 
          ? firstNotification.body 
          : `You have ${count} new messages`,
        clickAction: firstNotification.clickAction,
        data: {
          ...firstNotification.data,
          batchCount: count,
          batched: true
        }
      };
    } else if (type === 'APPLICATION_CREATED') {
      const count = notifications.length;
      return {
        type: 'APPLICATION_CREATED',
        title: count === 1 ? 'New Application' : `${count} New Applications`,
        body: count === 1 
          ? firstNotification.body 
          : `You have ${count} new applications`,
        clickAction: '/applications',
        data: {
          batchCount: count,
          batched: true,
          applicationIds: notifications.map(n => n.data?.applicationId).filter(Boolean)
        }
      };
    }

    return firstNotification;
  }

  async scheduleRetry(notificationId, retryData) {
    const attempts = retryData.attempts || 0;
    
    if (attempts >= this.MAX_RETRIES) {
      console.log(`[v1/Notification] Max retries reached for notification ${notificationId}`);
      return;
    }

    const delay = Math.min(
      this.INITIAL_RETRY_DELAY * Math.pow(2, attempts),
      this.MAX_RETRY_DELAY
    );

    const nextRetry = Date.now() + delay;

    this.retryQueue.set(notificationId, {
      ...retryData,
      attempts: attempts + 1,
      nextRetry
    });

    if (!this.retryTimer) {
      this.startRetryProcessor();
    }

    console.log(`[v1/Notification] Scheduled retry ${attempts + 1}/${this.MAX_RETRIES} for notification ${notificationId} in ${delay}ms`);
  }

  startRetryProcessor() {
    if (this.retryTimer) {
      return;
    }

    this.retryTimer = setInterval(async () => {
      await this.processRetryQueue();
    }, 1000);
  }

  async processRetryQueue() {
    const now = Date.now();
    const readyToRetry = [];

    for (const [notificationId, retryData] of this.retryQueue.entries()) {
      if (now >= retryData.nextRetry) {
        readyToRetry.push({ notificationId, retryData });
      }
    }

    for (const { notificationId, retryData } of readyToRetry) {
      this.retryQueue.delete(notificationId);
      await this.retryNotification(notificationId, retryData);
    }

    if (this.retryQueue.size === 0 && this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  async retryNotification(notificationId, retryData) {
    console.log(`[v1/Notification] Retrying notification ${notificationId} (attempt ${retryData.attempts})`);
    
    const sendResult = await this.sendNotification(
      retryData.userId,
      retryData.notificationData,
      notificationId
    );
    
    if (sendResult.success) {
      this.updateNotificationStatus(notificationId, 'DELIVERED', sendResult.method);
      console.log(`[v1/Notification] Retry successful for notification ${notificationId}`);
    } else {
      this.updateNotificationStatus(notificationId, 'FAILED', sendResult.method);
      
      const fcmFailed = sendResult.fcmResult && (
        !sendResult.fcmResult.success || 
        (sendResult.fcmResult.error && sendResult.fcmResult.reason !== 'no_tokens')
      );
      const shouldRetry = fcmFailed && retryData.attempts < this.MAX_RETRIES;
      
      if (shouldRetry) {
        await this.scheduleRetry(notificationId, retryData);
      } else {
        console.log(`[v1/Notification] Retry failed for notification ${notificationId}, max attempts reached or no retry needed`);
      }
    }
  }

  async getDeliveryStats(notificationId) {
    try {
      const { data: attempts, error } = await supabaseAdmin
        .from('v1_notification_delivery_attempts')
        .select('*')
        .eq('notification_id', notificationId)
        .order('attempted_at', { ascending: false });

      if (error) {
        return { success: false, error: error.message };
      }

      const stats = {
        totalAttempts: attempts?.length || 0,
        fcmAttempts: attempts?.filter((a) => a.method === 'fcm').length || 0,
        successfulAttempts: attempts?.filter((a) => a.success).length || 0,
        failedAttempts: attempts?.filter((a) => !a.success).length || 0,
        attempts: attempts || [],
      };

      return { success: true, stats };
    } catch (error) {
      console.error('[v1/Notification] Stats error:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Domain-specific notifications (15 triggers)
  // ============================================

  // 1. When influencer applies for a campaign, brand_owner is notified
  async notifyApplicationCreated(applicationId, campaignId, influencerId, brandId) {
    try {
      const { data: campaign } = await supabaseAdmin
        .from('v1_campaigns')
        .select('id, title')
        .eq('id', campaignId)
        .single();

      const { data: influencer } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', influencerId)
        .single();

      const notificationData = {
        type: 'APPLICATION_CREATED',
        title: 'New Application',
        body: `"${influencer?.name || 'influencer_name'}" applied for "${campaign?.title || 'campaign_name'}"`,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, campaignId, influencerId, brandId },
      };

      return await this.sendAndStoreNotification(brandId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Application created error:', error);
      return { success: false, error: error.message };
    }
  }

  // 2. When brand_owner accepts an application, influencer is notified
  async notifyApplicationAccepted(applicationId, influencerId, brandId) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: brand } = await supabaseAdmin
        .from('v1_brand_profiles')
        .select('brand_name')
        .eq('user_id', brandId)
        .single();

      const notificationData = {
        type: 'APPLICATION_ACCEPTED',
        title: 'Application Accepted!',
        body: `"${brand?.brand_name || 'brand_owner'}" accepted your application for "${application?.v1_campaigns?.title || 'campaign_name'}"`,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Application accepted error:', error);
      return { success: false, error: error.message };
    }
  }

  // 2.5. When an application is cancelled, the other party is notified
  async notifyApplicationCancelled(applicationId, otherUserId, cancelledByRole) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, influencer_id, v1_campaigns(title, brand_id)')
        .eq('id', applicationId)
        .single();

      if (!application) {
        return { success: false, error: 'Application not found' };
      }

      const campaignTitle = application?.v1_campaigns?.title || 'campaign_name';
      const cancelledByName = cancelledByRole === 'INFLUENCER' 
        ? 'The influencer' 
        : 'The brand owner';

      const notificationData = {
        type: 'APPLICATION_CANCELLED',
        title: 'Application Cancelled',
        body: `${cancelledByName} cancelled the application for "${campaignTitle}"`,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, cancelledByRole },
      };

      return await this.sendAndStoreNotification(otherUserId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Application cancelled error:', error);
      return { success: false, error: error.message };
    }
  }

  // 3. When brand_owner accepts the MOU, influencer is notified
  async notifyMOUAcceptedByBrand(mouId, applicationId, brandId, influencerId) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: brand } = await supabaseAdmin
        .from('v1_brand_profiles')
        .select('brand_name')
        .eq('user_id', brandId)
        .single();

      const campaignTitle = application?.v1_campaigns?.title || 'campaign_name';

      const notificationData = {
        type: 'MOU_ACCEPTED_BY_BRAND',
        title: 'MOU acceptance',
        body: `"${brand?.brand_name || 'brand_owner'}" accepted the MOU for "${campaignTitle}"`,
        clickAction: `/applications/${applicationId}/mou`,
        data: { mouId, applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] MOU accepted by brand error:', error);
      return { success: false, error: error.message };
    }
  }

  // 4. When influencer accepts the MOU, brand_owner is notified
  async notifyMOUAcceptedByInfluencer(mouId, applicationId, brandId, influencerId) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const campaignTitle = application?.v1_campaigns?.title || 'campaign_name';

      const notificationData = {
        type: 'MOU_ACCEPTED_BY_INFLUENCER',
        title: 'MOU acceptance',
        body: `"Influencer" accepted the MOU for "${campaignTitle}"`,
        clickAction: `/applications/${applicationId}/mou`,
        data: { mouId, applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(brandId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] MOU accepted by influencer error:', error);
      return { success: false, error: error.message };
    }
  }

  // 5. When both have accepted the MOU, brand_owner is notified
  // 6. When both have accepted the MOU, influencer is notified
  async notifyMOUFullyAccepted(mouId, applicationId, brandId, influencerId) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const campaignTitle = application?.v1_campaigns?.title || 'campaign_name';

      // Notify brand_owner
      const brandNotificationData = {
        type: 'MOU_FULLY_ACCEPTED',
        title: 'MOU accepted by both',
        body: 'Both party accepted the MOU, proceed with payment',
        clickAction: `/applications/${applicationId}/payment`,
        data: { 
          mouId, 
          applicationId, 
          brandId, 
          influencerId,
          recipient: 'brand'
        },
      };
      await this.sendAndStoreNotification(brandId, brandNotificationData);

      // Notify influencer
      const influencerNotificationData = {
        type: 'MOU_FULLY_ACCEPTED',
        title: 'MOU accepted by both',
        body: 'Both party accepted the MOU, wait for payment completion',
        clickAction: `/applications/${applicationId}`,
        data: { 
          mouId, 
          applicationId, 
          brandId, 
          influencerId,
          recipient: 'influencer'
        },
      };
      await this.sendAndStoreNotification(influencerId, influencerNotificationData);

      return { success: true };
    } catch (error) {
      console.error('[v1/Notification] MOU fully accepted error:', error);
      return { success: false, error: error.message };
    }
  }

  // 7. When brand_owner pays after accepting the MOU, influencer is notified
  async notifyPaymentCompleted(applicationId, brandId, influencerId) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title, requires_script)')
        .eq('id', applicationId)
        .single();

      const campaignTitle = application?.v1_campaigns?.title || 'campaign_name';
      const requiresScript = application?.v1_campaigns?.requires_script || false;
      
      // Check if script was already accepted (if script is required)
      let scriptAccepted = false;
      if (requiresScript) {
        const { data: script } = await supabaseAdmin
          .from('v1_scripts')
          .select('status')
          .eq('application_id', applicationId)
          .eq('status', 'ACCEPTED')
          .maybeSingle();
        scriptAccepted = !!script;
      }

      let body;
      if (requiresScript && !scriptAccepted) {
        body = `Payment Successful for the campaign "${campaignTitle}", submit your script`;
      } else {
        body = `Payment Successful for the campaign "${campaignTitle}", submit your work`;
      }

      const notificationData = {
        type: 'PAYMENT_COMPLETED',
        title: 'Payment Successful',
        body,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Payment completed error:', error);
      return { success: false, error: error.message };
    }
  }

  // 8. When influencer submits the script, brand_owner is notified
  async notifyScriptSubmitted(scriptId, applicationId, brandId, influencerId) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: influencer } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', influencerId)
        .maybeSingle();

      const notificationData = {
        type: 'SCRIPT_SUBMITTED',
        title: 'Script submitted',
        body: `"${influencer?.name || 'influencer_name'}" submitted a script for "${application?.v1_campaigns?.title || 'campaign_name'}"`,
        clickAction: `/applications/${applicationId}/scripts`,
        data: { scriptId, applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(brandId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Script submitted error:', error);
      return { success: false, error: error.message };
    }
  }

  // 9. When brand_owner chooses one of the 3 options for script: accept, revise or reject, influencer is notified
  async notifyScriptReview(scriptId, applicationId, brandId, influencerId, status, remarks = null) {
    try {
      const { data: script } = await supabaseAdmin
        .from('v1_scripts')
        .select('id, v1_applications(v1_campaigns(title))')
        .eq('id', scriptId)
        .single();

      const { data: brand } = await supabaseAdmin
        .from('v1_brand_profiles')
        .select('brand_name')
        .eq('user_id', brandId)
        .single();

      const campaignTitle = script?.v1_applications?.v1_campaigns?.title || 'Campaign_name';
      const brandName = brand?.brand_name || 'brand_owner_name';

      let title, body;
      if (status === 'ACCEPTED') {
        title = 'Script accepted';
        body = `"${brandName}" accepted your script for "${campaignTitle}". Proceed for work submission`;
      } else if (status === 'REVISION') {
        title = 'Script revised';
        body = `"${brandName}" revised your script for "${campaignTitle}"`;
      } else {
        title = 'Script rejected';
        body = `"${brandName}" rejected your script for "${campaignTitle}"`;
      }

      const notificationData = {
        type: 'SCRIPT_REVIEW',
        title,
        body,
        clickAction: `/applications/${applicationId}/scripts`,
        data: { scriptId, applicationId, brandId, influencerId, status, remarks },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Script review error:', error);
      return { success: false, error: error.message };
    }
  }

  // 10. When influencer submits the work, brand_owner is notified
  async notifyWorkSubmitted(workSubmissionId, applicationId, brandId, influencerId) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: influencer } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', influencerId)
        .maybeSingle();

      const notificationData = {
        type: 'WORK_SUBMITTED',
        title: 'Work submitted',
        body: `"${influencer?.name || 'influencer_name'}" submitted a work for "${application?.v1_campaigns?.title || 'campaign_name'}"`,
        clickAction: `/applications/${applicationId}/work`,
        data: { workSubmissionId, applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(brandId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Work submitted error:', error);
      return { success: false, error: error.message };
    }
  }

  // 11. When brand_owner chooses one of the 3 options for work: accept, revise or reject, influencer is notified
  async notifyWorkReview(workSubmissionId, applicationId, brandId, influencerId, status, remarks = null) {
    try {
      const { data: work } = await supabaseAdmin
        .from('v1_work_submissions')
        .select('id, v1_applications(v1_campaigns(title))')
        .eq('id', workSubmissionId)
        .single();

      const { data: brand } = await supabaseAdmin
        .from('v1_brand_profiles')
        .select('brand_name')
        .eq('user_id', brandId)
        .single();

      const campaignTitle = work?.v1_applications?.v1_campaigns?.title || 'Campaign_name';
      const brandName = brand?.brand_name || 'brand_owner_name';

      let title, body;
      if (status === 'ACCEPTED') {
        title = 'Work accepted';
        body = `"${brandName}" accepted your work for "${campaignTitle}". Wait for your payout.`;
      } else if (status === 'REVISION') {
        title = 'Work revised';
        body = `"${brandName}" revised your work for "${campaignTitle}"`;
      } else {
        title = 'Work rejected';
        body = `"${brandName}" rejected your work for "${campaignTitle}"`;
      }

      const notificationData = {
        type: 'WORK_REVIEW',
        title,
        body,
        clickAction: `/applications/${applicationId}/work`,
        data: { workSubmissionId, applicationId, brandId, influencerId, status, remarks },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Work review error:', error);
      return { success: false, error: error.message };
    }
  }

  // 12 & 14. When campaign gets completed, brand_owner is notified
  async notifyCampaignCompleted(campaignId, brandId) {
    try {
      const { data: campaign } = await supabaseAdmin
        .from('v1_campaigns')
        .select('id, title')
        .eq('id', campaignId)
        .single();

      const campaignTitle = campaign?.title || 'campaign_name';

      const notificationData = {
        type: 'CAMPAIGN_COMPLETED',
        title: 'Campaign completed',
        body: `Congratulations! Your campaign named "${campaignTitle}" is now complete.`,
        clickAction: `/campaigns/${campaignId}`,
        data: { 
          campaignId, 
          brandId
        },
      };

      return await this.sendAndStoreNotification(brandId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Campaign completed error:', error);
      return { success: false, error: error.message };
    }
  }

  // 13. When influencer gets payout, influencer is notified
  async notifyPayoutReleased(payoutId, applicationId, influencerId, amount) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const campaignTitle = application?.v1_campaigns?.title || 'campaign_name';

      const notificationData = {
        type: 'PAYOUT_RELEASED',
        title: 'Payout Released',
        body: `Your payout for "${campaignTitle}" has been released`,
        clickAction: `/applications/${applicationId}`,
        data: { payoutId, applicationId, influencerId, amount },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Payout released error:', error);
      return { success: false, error: error.message };
    }
  }

  // 15. New chat message will be notified
  async notifyChatMessage(applicationId, senderId, recipientId, messagePreview) {
    try {
      const { data: sender } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', senderId)
        .maybeSingle();

      const notificationData = {
        type: 'CHAT_MESSAGE',
        title: sender?.name || 'Sender name',
        body: messagePreview || 'message sent',
        clickAction: `/applications/${applicationId}/chat`,
        data: { applicationId, senderId, recipientId },
      };

      return await this.sendAndStoreNotification(recipientId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Chat message error:', error);
      return { success: false, error: error.message };
    }
  }

}

module.exports = new NotificationService();
