const { supabaseAdmin } = require('../db/config');
const fcmService = require('./fcmService');
const { getNotificationTemplate, getScriptReviewTemplate, getWorkReviewTemplate } = require('../utils/notificationTemplates');

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

    // Socket.io instance
    this.io = null;
  }

  setSocket(ioInstance) {
    this.io = ioInstance;
    console.log('[v1/Notification] Socket.io instance attached to NotificationService');
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
    // Fire-and-forget logging
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
    }).catch(() => { }); // Silently ignore errors
  }

  async sendFCMNotification(userId, notificationData) {
    try {
      if (!fcmService.initialized) {
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

  /**
   * Send notification via FCM
   * IMPORTANT: FCM is ALWAYS attempted if FCM service is initialized,
   * regardless of user online/offline/away status. This ensures users
   * receive push notifications consistently.
   * 
   * @param {string} userId - User ID to send notification to
   * @param {Object} notificationData - Notification data
   * @param {string|null} notificationId - Optional notification ID for logging
   * @returns {Promise<Object>} Result with success, method, and fcmResult
   */
  async sendNotification(userId, notificationData, notificationId = null) {
    let fcmResult = null;

    // Always attempt FCM if initialized
    if (!fcmService.initialized) {
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
      }
    }

    const success = (fcmResult?.success && fcmResult.sent > 0);
    const method = fcmService.initialized ? 'fcm' : 'none';

    // 🔥 If socket.io is enabled, emit a realtime event to the user
    if (this.io) {
      try {
        const eventType = [
          'APPLICATION_CREATED', 'APPLICATION_ACCEPTED', 'APPLICATION_CANCELLED',
          'MOU_ACCEPTED_BY_BRAND', 'MOU_ACCEPTED_BY_INFLUENCER', 'MOU_FULLY_ACCEPTED',
          'PAYOUT_RELEASED', 'PAYMENT_COMPLETED', 'CAMPAIGN_COMPLETED'
        ].includes(notificationData.type) ? 'campaign_updated' : 'notification_received';

        this.io.to(`user_${userId}`).emit(eventType, {
          notificationId,
          type: notificationData.type,
          data: notificationData.data,
          timestamp: new Date().toISOString()
        });
        console.log(`[v1/Notification] Emitted realtime ${eventType} event to user_${userId}`);
      } catch (wsError) {
        console.error(`[v1/Notification] Failed to emit realtime event to user_${userId}:`, wsError);
      }
    }

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

    // Include status for review types so ACCEPTED vs REVISION are distinct
    if (['SCRIPT_REVIEW', 'WORK_REVIEW'].includes(type) && data?.applicationId) {
      return `${userId}_${type}_${data.applicationId}_${data.status || 'unknown'}`;
    }

    if (['APPLICATION_ACCEPTED', 'APPLICATION_CREATED', 'SCRIPT_SUBMITTED',
      'WORK_SUBMITTED', 'MOU_ACCEPTED_BY_BRAND', 'MOU_ACCEPTED_BY_INFLUENCER',
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
        return { success: true, notification: { id: 'cached' }, duplicate: true };
      }

      // Default duplicate detection window is 30 seconds
      // For certain one-time domain events (like MOU fully accepted),
      // we extend the window to effectively "once per lifecycle".
      let timeWindow = 30; // seconds
      if (notificationData.type === 'MOU_FULLY_ACCEPTED') {
        // MOU can only be "fully accepted" once per application per user
        // Use a large window (24 hours) to strongly guard against duplicates
        timeWindow = 24 * 60 * 60; // 24 hours in seconds
      }
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
      } else if (['SCRIPT_REVIEW', 'WORK_REVIEW'].includes(notificationData.type) &&
        notificationData.data?.applicationId) {
        existingQuery = existingQuery
          .eq('data->>applicationId', notificationData.data.applicationId)
          .eq('data->>status', notificationData.data.status || 'unknown');
      } else if (['APPLICATION_ACCEPTED', 'APPLICATION_CREATED', 'SCRIPT_SUBMITTED',
        'WORK_SUBMITTED', 'MOU_ACCEPTED_BY_BRAND', 'MOU_ACCEPTED_BY_INFLUENCER',
        'MOU_FULLY_ACCEPTED', 'PAYOUT_RELEASED', 'PAYMENT_COMPLETED', 'CAMPAIGN_COMPLETED'].includes(notificationData.type) &&
        notificationData.data?.applicationId) {
        existingQuery = existingQuery.eq('data->>applicationId', notificationData.data.applicationId);
      }

      const { data: existing } = await existingQuery.maybeSingle();

      if (existing) {
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
    // Fire-and-forget status update
    const updateData = {
      delivery_status: status,
      ...(method && { delivery_method: method }),
    };

    Promise.resolve().then(async () => {
      try {
        await supabaseAdmin
          .from('v1_notifications')
          .update(updateData)
          .eq('id', notificationId);
      } catch (err) {
        console.error('[v1/Notification] Failed to update status:', err);
      }
    }).catch(() => { }); // Silently ignore errors

    return { success: true };
  }

  async sendAndStoreNotification(userId, notificationData) {
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
    const count = notifications.length;

    if (type === 'CHAT_MESSAGE') {
      const template = getNotificationTemplate('CHAT_MESSAGE_BATCHED', {
        count,
        firstNotification,
        applicationId: firstNotification.data?.applicationId,
      });
      return {
        type: 'CHAT_MESSAGE',
        ...template,
        data: {
          ...firstNotification.data,
          batchCount: count,
          batched: true
        }
      };
    } else if (type === 'APPLICATION_CREATED') {
      const template = getNotificationTemplate('APPLICATION_CREATED_BATCHED', {
        count,
        firstNotification,
      });
      return {
        type: 'APPLICATION_CREATED',
        ...template,
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
      return;
    }

    const delay = Math.min(
      this.INITIAL_RETRY_DELAY * Math.pow(2, attempts),
      this.MAX_RETRY_DELAY
    );

    this.retryQueue.set(notificationId, {
      ...retryData,
      attempts: attempts + 1,
      nextRetry: Date.now() + delay
    });

    if (!this.retryTimer) {
      this.startRetryProcessor();
    }
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
    const sendResult = await this.sendNotification(
      retryData.userId,
      retryData.notificationData,
      notificationId
    );

    if (sendResult.success) {
      this.updateNotificationStatus(notificationId, 'DELIVERED', sendResult.method);
    } else {
      this.updateNotificationStatus(notificationId, 'FAILED', sendResult.method);

      const fcmFailed = sendResult.fcmResult && (
        !sendResult.fcmResult.success ||
        (sendResult.fcmResult.error && sendResult.fcmResult.reason !== 'no_tokens')
      );

      if (fcmFailed && retryData.attempts < this.MAX_RETRIES) {
        await this.scheduleRetry(notificationId, retryData);
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

      const template = getNotificationTemplate('APPLICATION_CREATED', {
        campaignTitle: campaign?.title,
        influencerName: influencer?.name,
        applicationId,
      });

      const notificationData = {
        type: 'APPLICATION_CREATED',
        ...template,
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

      const template = getNotificationTemplate('APPLICATION_ACCEPTED', {
        campaignTitle: application?.v1_campaigns?.title,
        brandName: brand?.brand_name,
        applicationId,
      });

      const notificationData = {
        type: 'APPLICATION_ACCEPTED',
        ...template,
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

      const cancelledByName = cancelledByRole === 'INFLUENCER'
        ? 'The influencer'
        : 'The brand';

      const template = getNotificationTemplate('APPLICATION_CANCELLED', {
        campaignTitle: application?.v1_campaigns?.title,
        cancelledByName,
        applicationId,
      });

      const notificationData = {
        type: 'APPLICATION_CANCELLED',
        ...template,
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

      const template = getNotificationTemplate('MOU_ACCEPTED_BY_BRAND', {
        campaignTitle: application?.v1_campaigns?.title,
        brandName: brand?.brand_name,
        applicationId,
      });

      const notificationData = {
        type: 'MOU_ACCEPTED_BY_BRAND',
        ...template,
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
        .select('id, influencer_id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: influencer } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', influencerId)
        .maybeSingle();

      const template = getNotificationTemplate('MOU_ACCEPTED_BY_INFLUENCER', {
        campaignTitle: application?.v1_campaigns?.title,
        influencerName: influencer?.name,
        applicationId,
      });

      const notificationData = {
        type: 'MOU_ACCEPTED_BY_INFLUENCER',
        ...template,
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

      const campaignTitle = application?.v1_campaigns?.title || 'Campaign';

      const brandTemplate = getNotificationTemplate('MOU_FULLY_ACCEPTED_BRAND', {
        campaignTitle,
        applicationId,
      });

      const brandNotificationData = {
        type: 'MOU_FULLY_ACCEPTED',
        ...brandTemplate,
        data: {
          mouId,
          applicationId,
          brandId,
          influencerId,
          recipient: 'brand'
        },
      };
      await this.sendAndStoreNotification(brandId, brandNotificationData);

      const influencerTemplate = getNotificationTemplate('MOU_FULLY_ACCEPTED_INFLUENCER', {
        campaignTitle,
        applicationId,
      });

      const influencerNotificationData = {
        type: 'MOU_FULLY_ACCEPTED',
        ...influencerTemplate,
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

      const campaignTitle = application?.v1_campaigns?.title || 'Campaign';
      const requiresScript = application?.v1_campaigns?.requires_script || false;

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

      const template = getNotificationTemplate('PAYMENT_COMPLETED', {
        campaignTitle,
        applicationId,
        requiresScript,
        scriptAccepted,
      });

      const notificationData = {
        type: 'PAYMENT_COMPLETED',
        ...template,
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

      const template = getNotificationTemplate('SCRIPT_SUBMITTED', {
        campaignTitle: application?.v1_campaigns?.title,
        influencerName: influencer?.name,
        applicationId,
      });

      const notificationData = {
        type: 'SCRIPT_SUBMITTED',
        ...template,
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

      const template = getScriptReviewTemplate(
        status,
        script?.v1_applications?.v1_campaigns?.title || 'Campaign',
        brand?.brand_name || 'The brand',
        applicationId
      );

      const notificationData = {
        type: 'SCRIPT_REVIEW',
        ...template,
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

      const template = getNotificationTemplate('WORK_SUBMITTED', {
        campaignTitle: application?.v1_campaigns?.title,
        influencerName: influencer?.name,
        applicationId,
      });

      const notificationData = {
        type: 'WORK_SUBMITTED',
        ...template,
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

      const template = getWorkReviewTemplate(
        status,
        work?.v1_applications?.v1_campaigns?.title || 'Campaign',
        brand?.brand_name || 'The brand',
        applicationId
      );

      const notificationData = {
        type: 'WORK_REVIEW',
        ...template,
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

      const template = getNotificationTemplate('CAMPAIGN_COMPLETED', {
        campaignTitle: campaign?.title,
        campaignId,
      });

      const notificationData = {
        type: 'CAMPAIGN_COMPLETED',
        ...template,
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

      const template = getNotificationTemplate('PAYOUT_RELEASED', {
        campaignTitle: application?.v1_campaigns?.title,
        applicationId,
      });

      const notificationData = {
        type: 'PAYOUT_RELEASED',
        ...template,
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

      // Get chatId from applicationId
      const ChatService = require('./chatService');
      const chat = await ChatService.getChatByApplication(applicationId);
      const chatId = chat?.id;

      const template = getNotificationTemplate('CHAT_MESSAGE', {
        senderName: sender?.name,
        messagePreview,
        applicationId,
        chatId,
      });

      const notificationData = {
        type: 'CHAT_MESSAGE',
        ...template,
        data: { applicationId, senderId, recipientId, chatId },
      };

      return await this.sendAndStoreNotification(recipientId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Chat message error:', error);
      return { success: false, error: error.message };
    }
  }

}

module.exports = new NotificationService();
