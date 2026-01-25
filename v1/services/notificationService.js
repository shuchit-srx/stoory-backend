const { supabaseAdmin } = require('../db/config');
const fcmService = require('./fcmService');

class NotificationService {
  constructor() {
    this.onlineUsers = new Map(); // Map<userId, Set<socketId>>
    this.io = null;
    
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
  }

  setSocketIO(io) {
    this.io = io;
  }

  registerOnlineUser(userId, socketId) {
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId).add(socketId);
  }

  unregisterOnlineUser(userId, socketId) {
    if (!this.onlineUsers.has(userId)) return;
    const sockets = this.onlineUsers.get(userId);
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.onlineUsers.delete(userId);
    }
  }

  isUserOnline(userId) {
    return this.onlineUsers.has(userId) && this.onlineUsers.get(userId).size > 0;
  }

  isUserInChatRoom(userId, applicationId) {
    if (!this.io || !this.isUserOnline(userId)) {
      return false;
    }

    const roomName = `app_${applicationId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);
    if (!room || room.size === 0) {
      return false;
    }

    // Check if any of user's sockets are in the room
    const userSockets = this.onlineUsers.get(userId);
    if (!userSockets || userSockets.size === 0) {
      return false;
    }

    for (const socketId of userSockets) {
      if (room.has(socketId)) {
        return true;
      }
    }

    return false;
  }

  async logDeliveryAttempt(notificationId, method, success, details = {}) {
    try {
      const { error } = await supabaseAdmin.from('v1_notification_delivery_attempts').insert({
        notification_id: notificationId,
        method,
        success,
        details,
        attempted_at: new Date().toISOString(),
      });

      if (error) {
        console.error('[v1/Notification] Failed to log delivery attempt:', error);
      }
    } catch (err) {
      console.error('[v1/Notification] Error logging delivery attempt:', err);
    }
  }

  sendSocketNotification(userId, notificationData) {
    if (!this.io) {
      console.warn('[v1/Notification] Socket.IO not initialized');
      return { sent: false, reason: 'not_initialized' };
    }

    if (!this.isUserOnline(userId)) {
      return { sent: false, reason: 'offline' };
    }

    const socketIds = Array.from(this.onlineUsers.get(userId));
    let sentCount = 0;
    let failedCount = 0;
    const failedSockets = [];

    socketIds.forEach((socketId) => {
      try {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('notification', notificationData);
          sentCount++;
        } else {
          failedCount++;
          failedSockets.push(socketId);
        }
      } catch (err) {
        failedCount++;
        failedSockets.push(socketId);
        console.error('[v1/Notification] Socket send error:', err);
      }
    });

    return {
      sent: sentCount > 0,
      count: sentCount,
      failed: failedCount,
      failedSockets,
    };
  }

  async sendFCMNotification(userId, notificationData) {
    try {
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

      // Add reason for clarity
      if (result.success && result.sent === 0) {
        result.reason = 'no_tokens';
      }

      return result;
    } catch (error) {
      console.error('[v1/Notification] FCM send error:', error);
      return { success: false, error: error.message, sent: 0, failed: 0 };
    }
  }

  async sendNotification(userId, notificationData, notificationId = null) {
    const online = this.isUserOnline(userId);
    let deliveryResult = null;
    let method = null;

    console.log(`[v1/Notification] Sending notification to user ${userId} (online: ${online})`);

    if (online) {
      method = 'socket';
      deliveryResult = this.sendSocketNotification(userId, notificationData);

      if (notificationId) {
        await this.logDeliveryAttempt(notificationId, method, deliveryResult.sent, {
          socketCount: deliveryResult.count || 0,
          failedCount: deliveryResult.failed || 0,
          failedSockets: deliveryResult.failedSockets || [],
        });
      }

      if (deliveryResult.sent) {
        console.log(`[v1/Notification] Socket notification sent successfully to user ${userId}`);
        return { success: true, method, deliveryResult };
      }

      // Fallback to FCM if socket send failed
      console.log(`[v1/Notification] Socket send failed for user ${userId}, falling back to FCM`);
    }

    method = 'fcm';
    deliveryResult = await this.sendFCMNotification(userId, notificationData);

    // Improved success condition: success=true with sent=0 is valid (no tokens, not an error)
    const fcmSuccess = deliveryResult.success && (
      deliveryResult.sent > 0 || 
      (deliveryResult.sent === 0 && deliveryResult.reason === 'no_tokens' && !deliveryResult.error)
    );

    if (notificationId) {
      await this.logDeliveryAttempt(notificationId, method, fcmSuccess, {
        sent: deliveryResult.sent || 0,
        failed: deliveryResult.failed || 0,
        error: deliveryResult.error || null,
        reason: deliveryResult.reason || null,
        details: deliveryResult.details || null,
      });
    }

    console.log(`[v1/Notification] FCM notification result for user ${userId}: success=${fcmSuccess}, sent=${deliveryResult.sent || 0}`);

    return { success: fcmSuccess, method, deliveryResult };
  }

  async storeNotification(notificationData) {
    try {
      // Deduplication: Check for recent duplicate notifications (within 5 seconds)
      // Prevents duplicate notifications from being created due to retries or race conditions
      if (notificationData.type === 'CHAT_MESSAGE' && notificationData.data?.applicationId) {
        const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
        const { data: existing } = await supabaseAdmin
          .from('v1_notifications')
          .select('id')
          .eq('user_id', notificationData.userId)
          .eq('type', notificationData.type)
          .eq('data->>applicationId', notificationData.data.applicationId)
          .gte('created_at', fiveSecondsAgo)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing) {
          console.log(`[v1/Notification] Duplicate notification detected (applicationId: ${notificationData.data.applicationId}), skipping`);
          return { success: true, notification: existing, duplicate: true };
        }
      }

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
          created_at: new Date().toISOString(),
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
        updated_at: new Date().toISOString(),
      };

      if (method) {
        updateData.delivery_method = method;
      }

      const { error } = await supabaseAdmin.from('v1_notifications').update(updateData).eq('id', notificationId);

      if (error) {
        console.error('[v1/Notification] Update status failed:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('[v1/Notification] Update status error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendAndStoreNotification(userId, notificationData) {
    // Check if notification should be batched
    const shouldBatch = this.shouldBatchNotification(notificationData.type);
    
    if (shouldBatch) {
      return await this.batchNotification(userId, notificationData);
    }

    const storeResult = await this.storeNotification({ ...notificationData, userId });
    if (!storeResult.success) {
      return { stored: false, sent: false, error: storeResult.error };
    }

    const notificationId = storeResult.notification.id;
    const sendResult = await this.sendNotification(userId, notificationData, notificationId);

    if (sendResult.success) {
      await this.updateNotificationStatus(notificationId, 'DELIVERED', sendResult.method);
    } else {
      await this.updateNotificationStatus(notificationId, 'FAILED', sendResult.method);
      
      // Schedule retry for failed FCM notifications
      if (sendResult.method === 'fcm' && sendResult.deliveryResult?.error) {
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
      deliveryResult: sendResult.deliveryResult,
    };
  }

  shouldBatchNotification(type) {
    // Batch notifications that can be grouped together
    return ['CHAT_MESSAGE', 'APPLICATION_CREATED'].includes(type);
  }

  async batchNotification(userId, notificationData) {
    // Add to queue
    if (!this.notificationQueue.has(userId)) {
      this.notificationQueue.set(userId, []);
    }
    this.notificationQueue.get(userId).push(notificationData);

    // Start batch timer if not already running
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushAllBatches();
      }, this.BATCH_WINDOW);
    }

    // Flush if batch size reached
    const userQueue = this.notificationQueue.get(userId);
    if (userQueue.length >= this.MAX_BATCH_SIZE) {
      await this.flushBatchForUser(userId);
    }

    return { stored: true, sent: true, batched: true };
  }

  async flushBatchForUser(userId) {
    const queue = this.notificationQueue.get(userId);
    if (!queue || queue.length === 0) {
      return;
    }

    this.notificationQueue.delete(userId);

    // Create batched notification
    const batchedData = this.createBatchedNotification(queue);
    
    // Store and send batched notification
    const storeResult = await this.storeNotification({ ...batchedData, userId });
    if (!storeResult.success) {
      console.error('[v1/Notification] Failed to store batched notification:', storeResult.error);
      return;
    }

    const notificationId = storeResult.notification.id;
    const sendResult = await this.sendNotification(userId, batchedData, notificationId);

    if (sendResult.success) {
      await this.updateNotificationStatus(notificationId, 'DELIVERED', sendResult.method);
    } else {
      await this.updateNotificationStatus(notificationId, 'FAILED', sendResult.method);
      
      if (sendResult.method === 'fcm' && sendResult.deliveryResult?.error) {
        await this.scheduleRetry(notificationId, {
          userId,
          notificationData: batchedData,
          attempts: 0
        });
      }
    }
  }

  async flushAllBatches() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const userIds = Array.from(this.notificationQueue.keys());
    for (const userId of userIds) {
      await this.flushBatchForUser(userId);
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
      const lastNotification = notifications[notifications.length - 1];
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

    // Calculate delay with exponential backoff
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

    // Start retry timer if not running
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
    }, 1000); // Check every second
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

    // Stop timer if queue is empty
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
      await this.updateNotificationStatus(notificationId, 'DELIVERED', sendResult.method);
      console.log(`[v1/Notification] Retry successful for notification ${notificationId}`);
    } else {
      await this.updateNotificationStatus(notificationId, 'FAILED', sendResult.method);
      
      // Schedule another retry if not at max
      if (sendResult.method === 'fcm' && retryData.attempts < this.MAX_RETRIES) {
        await this.scheduleRetry(notificationId, retryData);
      } else {
        console.log(`[v1/Notification] Retry failed for notification ${notificationId}, max attempts reached`);
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
        socketAttempts: attempts?.filter((a) => a.method === 'socket').length || 0,
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

  // Domain-specific notifications

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
        title: 'Application Accepted! 🎉',
        body: `${brand?.brand_name || 'Brand'} accepted your application for "${application?.v1_campaigns?.title || 'campaign'}"`,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Application accepted error:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyApplicationCancelled(applicationId, cancelledById, otherUserId, reason = null) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, influencer_id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: canceller } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', cancelledById)
        .single();

      const notificationData = {
        type: 'APPLICATION_CANCELLED',
        title: 'Application Cancelled',
        body: `${canceller?.name || 'User'} cancelled the application for "${application?.v1_campaigns?.title || 'campaign'}"`,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, cancelledById, reason },
      };

      return await this.sendAndStoreNotification(otherUserId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Application cancelled error:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyPaymentCompleted(applicationId, brandId, influencerId) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: paymentOrder } = await supabaseAdmin
        .from('v1_payment_orders')
        .select('amount')
        .eq('application_id', applicationId)
        .eq('status', 'VERIFIED')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const notificationData = {
        type: 'PAYMENT_COMPLETED',
        title: 'Payment Received! 💰',
        body: `Payment of ₹${paymentOrder?.amount || 0} completed for "${application?.v1_campaigns?.title || 'campaign'}"`,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, brandId, influencerId, amount: paymentOrder?.amount || 0 },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Payment completed error:', error);
      return { success: false, error: error.message };
    }
  }

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

      let title;
      let body;
      const campaignTitle = script?.v1_applications?.v1_campaigns?.title || 'campaign';

      if (status === 'ACCEPTED') {
        title = 'Script Accepted! ✅';
        body = `${brand?.brand_name || 'Brand'} accepted your script for "${campaignTitle}"`;
      } else if (status === 'REVISION') {
        title = 'Script Revision Required';
        body = `${brand?.brand_name || 'Brand'} requested revisions for "${campaignTitle}"`;
      } else {
        title = 'Script Rejected';
        body = `${brand?.brand_name || 'Brand'} rejected your script for "${campaignTitle}"`;
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

      const campaignTitle = work?.v1_applications?.v1_campaigns?.title || 'campaign';
      let title;
      let body;

      if (status === 'ACCEPTED') {
        title = 'Work Approved! 🎊';
        body = `${brand?.brand_name || 'Brand'} approved your work for "${campaignTitle}"`;
      } else if (status === 'REVISION') {
        title = 'Work Revision Required';
        body = `${brand?.brand_name || 'Brand'} requested revisions for "${campaignTitle}"`;
      } else {
        title = 'Work Rejected';
        body = `${brand?.brand_name || 'Brand'} rejected your work for "${campaignTitle}"`;
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

  async notifyChatMessage(applicationId, senderId, recipientId, messagePreview) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: sender } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', senderId)
        .maybeSingle();

      const notificationData = {
        type: 'CHAT_MESSAGE',
        title: 'New Message',
        body: `${sender?.name || 'Someone'} sent you a message${messagePreview ? `: ${messagePreview.substring(0, 50)}${messagePreview.length > 50 ? '...' : ''}` : ''}`,
        clickAction: `/applications/${applicationId}/chat`,
        data: { applicationId, senderId, recipientId },
      };

      return await this.sendAndStoreNotification(recipientId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Chat message error:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyPayoutReleased(payoutId, applicationId, influencerId, amount) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const notificationData = {
        type: 'PAYOUT_RELEASED',
        title: 'Payout Released! 💸',
        body: `Your payout of ₹${amount || 0} has been released for "${application?.v1_campaigns?.title || 'campaign'}"`,
        clickAction: `/applications/${applicationId}`,
        data: { payoutId, applicationId, influencerId, amount },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Payout released error:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyApplicationCreated(applicationId, campaignId, influencerId, brandId) {
    try {
      const { data: campaign } = await supabaseAdmin
        .from('v1_campaigns')
        .select('id, title, image_url')
        .eq('id', campaignId)
        .single();

      const { data: influencer } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', influencerId)
        .single();

      const notificationData = {
        type: 'APPLICATION_CREATED',
        title: 'New Application Received',
        body: `${influencer?.name || 'An influencer'} sent an application for "${campaign?.title || 'campaign'}"`,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, campaignId, influencerId, brandId },
      };

      return await this.sendAndStoreNotification(brandId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Application created error:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyApplicationApproved(applicationId, influencerId, brandId) {
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
        type: 'APPLICATION_APPROVED',
        title: 'Application Approved! 🎉',
        body: `${brand?.brand_name || 'Brand'} approved your application for "${application?.v1_campaigns?.title || 'campaign'}"`,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(influencerId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Application approved error:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyFlowStateChange(applicationId, newPhase, userId, customMessage = null) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const phaseMessages = {
        'APPLIED': 'Your application has been submitted',
        'ACCEPTED': 'Your application has been accepted! You can now proceed with payment',
        'SCRIPT': 'Time to submit your script',
        'WORK': 'Time to submit your work',
        'PAYOUT': 'Your work has been approved! Payout will be processed soon',
        'COMPLETED': 'Application completed successfully! 🎊',
        'CANCELLED': 'Application has been cancelled'
      };

      const message = customMessage || phaseMessages[newPhase] || `Application phase changed to ${newPhase}`;

      const notificationData = {
        type: 'FLOW_STATE_CHANGE',
        title: 'Application Update',
        body: message,
        clickAction: `/applications/${applicationId}`,
        data: { applicationId, newPhase, userId },
      };

      return await this.sendAndStoreNotification(userId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Flow state change error:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyConversationClosed(applicationId, closedById, otherUserId, message = null) {
    try {
      const { data: application } = await supabaseAdmin
        .from('v1_applications')
        .select('id, v1_campaigns(title)')
        .eq('id', applicationId)
        .single();

      const { data: closer } = await supabaseAdmin
        .from('v1_users')
        .select('name')
        .eq('id', closedById)
        .maybeSingle();

      const notificationData = {
        type: 'CONVERSATION_CLOSED',
        title: 'Conversation Closed',
        body: message || `Conversation for "${application?.v1_campaigns?.title || 'campaign'}" has been closed by ${closer?.name || 'admin'}`,
        clickAction: `/applications/${applicationId}/chat`,
        data: { applicationId, closedById, otherUserId },
      };

      return await this.sendAndStoreNotification(otherUserId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Conversation closed error:', error);
      return { success: false, error: error.message };
    }
  }

  async notifyCampaignUpdate(campaignId, userId, title, body, data = {}) {
    try {
      const notificationData = {
        type: 'CAMPAIGN_UPDATE',
        title: title || 'Campaign Update',
        body: body || 'Your campaign has been updated',
        clickAction: `/campaigns/${campaignId}`,
        data: { campaignId, userId, ...data },
      };

      return await this.sendAndStoreNotification(userId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Campaign update error:', error);
      return { success: false, error: error.message };
    }
  }

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
        title: 'New Script Submitted',
        body: `${influencer?.name || 'Influencer'} submitted a script for "${application?.v1_campaigns?.title || 'campaign'}"`,
        clickAction: `/applications/${applicationId}/scripts`,
        data: { scriptId, applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(brandId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Script submitted error:', error);
      return { success: false, error: error.message };
    }
  }

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
        title: 'New Work Submitted',
        body: `${influencer?.name || 'Influencer'} submitted work for "${application?.v1_campaigns?.title || 'campaign'}"`,
        clickAction: `/applications/${applicationId}/work`,
        data: { workSubmissionId, applicationId, brandId, influencerId },
      };

      return await this.sendAndStoreNotification(brandId, notificationData);
    } catch (error) {
      console.error('[v1/Notification] Work submitted error:', error);
      return { success: false, error: error.message };
    }
  }

}

module.exports = new NotificationService();

