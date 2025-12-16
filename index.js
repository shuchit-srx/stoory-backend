const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const compression = require("compression");
const morgan = require("morgan");
require("dotenv").config();

const { setupSecurityMiddleware } = require("./middleware/security");
const MessageHandler = require("./sockets/messageHandler");

// Import routes
const authRoutes = require("./routes/auth");
const campaignRoutes = require("./routes/campaigns");
const dashboardRoutes = require("./routes/dashboard");

const requestRoutes = require("./routes/requests");
const conversationRoutes = require("./routes/conversations");
const userRoutes = require("./routes/users");
const messageRoutes = require("./routes/messages");
const paymentRoutes = require("./routes/payments");
const subscriptionRoutes = require("./routes/subscriptions");
const reportRoutes = require("./routes/reports");
// Social platform routes moved to auth routes
const fcmRoutes = require("./routes/fcm");
const couponRoutes = require("./routes/coupons");
const attachmentRoutes = require("./routes/attachments");
const directStorageRoutes = require("./routes/directStorage");
const adminPaymentRoutes = require("./routes/adminPayments");
const adminWalletRoutes = require("./routes/adminWallet");
const notificationRoutes = require("./routes/notifications");
const commissionSettingsRoutes = require("./routes/commissionSettings");
const adminSettingsRoutes = require("./routes/adminSettings");
const enhancedWalletRoutes = require("./routes/enhancedWallet");
const socialPlatformRoutes = require("./routes/socialPlatforms");
const influencerRoutes = require("./routes/influencers");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
        "http://localhost:8081",
        "http://localhost:8080",
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/, // Local network
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/, // Local network
        /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/, // Local network
        // Production URLs - add your actual production frontend URL
        /^https:\/\/.*\.railway\.app$/, // Railway deployments
        /^https:\/\/.*\.onrender\.com$/, // Render deployments
        /^https:\/\/.*\.vercel\.app$/, // Vercel deployments
        /^https:\/\/.*\.netlify\.app$/, // Netlify deployments
      ],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type"],
  },
  transports: ['websocket', 'polling'], // Support both WebSocket and polling
  allowEIO3: true, // Support legacy Socket.IO clients

  // Connection timeout (30 seconds to establish connection)
  connectTimeout: 30000,

  // Enable heartbeat to keep connections alive
  // Wait 60 seconds for client response to ping
  pingTimeout: 60000,

  // Send ping every 25 seconds to check connection health
  pingInterval: 25000,

  // Max HTTP buffer size (for large messages like images)
  maxHttpBufferSize: 1e8, // 100MB

  // Upgrade timeout from HTTP to WebSocket
  upgradeTimeout: 10000,
});

// Health check endpoint (before security middleware)
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Stoory Backend is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// CORS debug endpoint
app.get("/cors-debug", (req, res) => {
  res.json({
    success: true,
    message: "CORS is working!",
    origin: req.headers.origin,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString(),
  });
});

// Socket.IO test endpoint
app.get("/test-socket", (req, res) => {
  const io = app.get("io");
  const testMessage = {
    success: true,
    message: "Socket.IO test message",
    timestamp: new Date().toISOString(),
    hasIo: !!io,
    connectedClients: io.engine.clientsCount || 0
  };

  // Emit test message to all connected clients
  if (io) {
    io.emit("test_message", testMessage);
  }

  res.json(testMessage);
});


// Setup security middleware
setupSecurityMiddleware(app);

// CORS test endpoint (after security middleware)
app.get("/api/cors-test", (req, res) => {
  res.json({
    success: true,
    message: "CORS is working from API!",
    origin: req.headers.origin,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// Socket notification test endpoint
app.post("/api/test-socket-notification", async (req, res) => {
  try {
    const { user_id, title, message, notification_id } = req.body;
    const io = app.get("io");

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required"
      });
    }

    if (!io) {
      return res.status(500).json({
        success: false,
        message: "Socket.IO not available"
      });
    }

    // Check if user is online
    const isOnline = messageHandler.isUserOnline(user_id);
    const onlineUsersCount = messageHandler.getOnlineUsersCount();

    console.log(`📊 [TEST] User ${user_id} - Online: ${isOnline}, Total online users: ${onlineUsersCount}`);

    // Check if this is a force send request
    const forceSend = req.body.force_send === true;

    // Store notification in database first (regardless of online status)
    const notificationService = require('./services/notificationService');
    const storeResult = await notificationService.storeNotification({
      user_id: user_id,
      type: 'message',
      title: title || 'Test Notification',
      message: message || 'This is a test notification',
      data: {
        notification_type: 'test',
        timestamp: new Date().toISOString(),
        user_id: user_id,
        test: true
      },
      priority: 'medium',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    if (!storeResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to store notification in database",
        error: storeResult.error
      });
    }

    // Only send socket notification if user is online OR force send is requested
    if (!isOnline && !forceSend) {
      return res.json({
        success: true,
        message: "User is offline - notification stored in database only",
        user_id: user_id,
        is_online: false,
        online_users_count: onlineUsersCount,
        delivery_method: "database_only",
        database_notification: storeResult.notification
      });
    }

    const notificationData = {
      type: 'test',
      data: {
        id: storeResult.notification.id,
        title: title || 'Test Notification',
        body: message || 'This is a test notification',
        created_at: new Date().toISOString(),
        test: true,
        user_id: user_id
      }
    };

    // Send notification to specific user's room
    io.to(`user_${user_id}`).emit('notification', notificationData);

    console.log(`📡 [TEST] Sent socket notification to user_${user_id}:`, notificationData);
    console.log(`💾 [TEST] Stored notification in database:`, storeResult.notification.id);

    res.json({
      success: true,
      message: "Socket notification sent to online user",
      user_id: user_id,
      notification: notificationData,
      database_notification: storeResult.notification,
      is_online: true,
      online_users_count: onlineUsersCount,
      delivery_method: "socket"
    });

  } catch (error) {
    console.error('❌ Error in test-socket-notification:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// Send test notification to all active socket users
app.post("/api/test-socket-notification-all", async (req, res) => {
  try {
    const { title, message } = req.body;
    const io = app.get("io");

    if (!io) {
      return res.status(500).json({
        success: false,
        message: "Socket.IO not available"
      });
    }

    // Get all online users
    const onlineUsers = messageHandler.getOnlineUsersWithSockets();
    const onlineUsersCount = messageHandler.getOnlineUsersCount();

    console.log(`📊 [TEST-ALL] Found ${onlineUsersCount} online users:`, onlineUsers.map(u => u.userId));

    if (onlineUsersCount === 0) {
      return res.json({
        success: true,
        message: "No active socket users found",
        online_users_count: 0,
        notifications_sent: 0,
        delivery_method: "none"
      });
    }

    const notificationService = require('./services/notificationService');
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Send notification to each online user
    for (const user of onlineUsers) {
      try {
        // Store notification in database
        const storeResult = await notificationService.storeNotification({
          user_id: user.userId,
          type: 'message',
          title: title || 'Test Notification to All Users',
          message: message || 'This is a test notification sent to all active users',
          data: {
            notification_type: 'test_all',
            timestamp: new Date().toISOString(),
            user_id: user.userId,
            test: true,
            sent_to_all: true
          },
          priority: 'medium',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });

        if (storeResult.success) {
          const notificationData = {
            type: 'test_all',
            data: {
              id: storeResult.notification.id,
              title: title || 'Test Notification to All Users',
              body: message || 'This is a test notification sent to all active users',
              created_at: new Date().toISOString(),
              test: true,
              user_id: user.userId,
              sent_to_all: true
            }
          };

          // Send socket notification
          io.to(user.room).emit('notification', notificationData);

          results.push({
            user_id: user.userId,
            socket_id: user.socketId,
            success: true,
            notification_id: storeResult.notification.id,
            delivery_method: 'socket'
          });

          successCount++;
          console.log(`📡 [TEST-ALL] Sent notification to user_${user.userId} (${user.socketId})`);
        } else {
          results.push({
            user_id: user.userId,
            socket_id: user.socketId,
            success: false,
            error: storeResult.error,
            delivery_method: 'failed'
          });
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ [TEST-ALL] Error sending to user_${user.userId}:`, error);
        results.push({
          user_id: user.userId,
          socket_id: user.socketId,
          success: false,
          error: error.message,
          delivery_method: 'failed'
        });
        errorCount++;
      }
    }

    console.log(`📊 [TEST-ALL] Completed: ${successCount} successful, ${errorCount} failed`);

    res.json({
      success: true,
      message: `Test notifications sent to ${successCount} active users`,
      online_users_count: onlineUsersCount,
      notifications_sent: successCount,
      notifications_failed: errorCount,
      delivery_method: "socket",
      results: results,
      summary: {
        total_users: onlineUsersCount,
        successful: successCount,
        failed: errorCount,
        success_rate: onlineUsersCount > 0 ? ((successCount / onlineUsersCount) * 100).toFixed(2) + '%' : '0%'
      }
    });

  } catch (error) {
    console.error('❌ Error in test-socket-notification-all:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// Debug: Direct message send via REST (mirrors socket chat:send)
app.post("/api/debug/direct-send", async (req, res) => {
  try {
    const { conversationId, senderId, text = '', attachments = null, metadata = null } = req.body;
    if (!conversationId || !senderId) {
      return res.status(400).json({ success: false, error: "conversationId and senderId are required" });
    }

    const { supabaseAdmin } = require('./supabase/client');
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('id, brand_owner_id, influencer_id, campaign_id, chat_status, flow_state')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found', details: convError || null, conversationId });
    }

    const isDirect = !conversation.campaign_id;
    if (!isDirect && conversation.chat_status !== 'real_time' && conversation.flow_state !== 'real_time') {
      return res.status(409).json({ success: false, error: 'Automated mode for this conversation' });
    }

    const receiverId = conversation.brand_owner_id === senderId
      ? conversation.influencer_id
      : conversation.brand_owner_id;

    const messageData = {
      conversation_id: conversationId,
      sender_id: senderId,
      receiver_id: receiverId,
      message: text,
      message_type: 'user_input',
      attachment_metadata: attachments || metadata || null,
      seen: false,
      updated_at: new Date().toISOString()
    };

    const { data: savedMessage, error: saveError } = await supabaseAdmin
      .from('messages')
      .insert(messageData)
      .select()
      .single();

    if (saveError) {
      console.error('❌ [DEBUG] direct-send save error:', saveError);
      return res.status(500).json({
        success: false,
        error: 'Failed to save message',
        details: {
          message: saveError.message || null,
          code: saveError.code || null,
          hint: saveError.hint || null,
          details: saveError.details || null
        },
        payload: messageData
      });
    }

    const io = app.get('io');
    if (io) {
      console.log(`💾 [DEBUG] direct-send saved ${savedMessage.id} -> emitting to room:${conversationId}`);
      io.to(`user_${senderId}`).emit('conversation_list_updated', {
        conversation_id: conversationId,
        message: savedMessage,
        action: 'message_sent'
      });
      io.to(`user_${receiverId}`).emit('conversation_list_updated', {
        conversation_id: conversationId,
        message: savedMessage,
        action: 'message_received'
      });
      io.to(`room:${conversationId}`).emit('chat:new', { message: savedMessage });
    }

    return res.json({ success: true, message: savedMessage });
  } catch (e) {
    console.error('❌ [DEBUG] direct-send exception:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Debug: Check conversation exists in DB (no auth, service role)
app.get("/api/debug/conversation/:id", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { supabaseAdmin } = require('./supabase/client');
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id, brand_owner_id, influencer_id, campaign_id, chat_status, flow_state, created_at')
      .eq('id', conversationId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ success: false, error: error.message, conversationId });
    }
    if (!data) {
      return res.status(404).json({ success: false, found: false, conversationId });
    }
    return res.json({ success: true, found: true, conversation: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Debug: Issue JWT for a user (development only)
app.get("/api/debug/token/:userId", async (req, res) => {
  try {
    const allow = (process.env.ALLOW_DEBUG_TOKEN || 'false').toLowerCase() === 'true';
    if ((process.env.NODE_ENV || 'development') === 'production' && !allow) {
      return res.status(403).json({ success: false, error: 'Disabled in production' });
    }
    const userId = req.params.userId;
    const authService = require('./utils/auth');
    const result = await authService.refreshToken(userId);
    if (!result.success) {
      return res.status(404).json({ success: false, error: result.message || 'Failed to issue token' });
    }
    return res.json({ success: true, token: result.token });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Get online users status endpoint
app.get("/api/online-users", (req, res) => {
  try {
    const onlineUsers = messageHandler.getOnlineUsersWithSockets();
    const onlineUsersCount = messageHandler.getOnlineUsersCount();

    res.json({
      success: true,
      online_users_count: onlineUsersCount,
      online_users: onlineUsers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting online users:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// Admin user check endpoint
app.get("/api/admin-check", async (req, res) => {
  try {
    const { supabaseAdmin } = require('./supabase/client');

    // Check if any admin user exists
    const { data: adminUsers, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("role", "admin")
      .eq("is_deleted", false);

    res.json({
      success: true,
      adminUsers: adminUsers || [],
      count: adminUsers?.length || 0,
      error: error || null,
      message: adminUsers?.length > 0 ? `${adminUsers.length} admin user(s) found` : "No admin users found"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Error checking admin users"
    });
  }
});

// Additional middleware
app.use(compression());
app.use(morgan("combined"));

// Add general request logging
app.use((req, res, next) => {
  next();
});

// Make Socket.IO available to controllers
app.set("io", io);

// Set socket for automated flow service
const automatedFlowService = require("./utils/automatedFlowService");
automatedFlowService.setIO(io);

// Set socket for socket emitter service
const socketEmitter = require("./services/socketEmitter");
socketEmitter.setIO(io);

// Set socket for admin payment flow service
const adminPaymentFlowService = require("./utils/adminPaymentFlowService");
adminPaymentFlowService.setSocketIO(io);

// Automatic expiry sweep (mark campaigns/bids as expired when timeline exceeded and no requests)
(() => {
  const ENABLE_EXPIRY_SWEEP = (process.env.ENABLE_EXPIRY_SWEEP || 'true').toLowerCase() === 'true';
  const SWEEP_MINUTES = parseInt(process.env.EXPIRY_SWEEP_MINUTES || '30', 10);
  if (!ENABLE_EXPIRY_SWEEP) {
    console.log("⏳ [ExpirySweep] Disabled via ENABLE_EXPIRY_SWEEP env");
    return;
  }
  const { supabaseAdmin } = require('./supabase/client');
  const runSweep = async (reason = 'scheduled') => {
    try {
      const { data, error } = await supabaseAdmin.rpc('sweep_expired_campaigns_and_bids');
      if (error) {
        console.error(`❌ [ExpirySweep] Failed (${reason}):`, error);
        return;
      }
      const result = Array.isArray(data) ? data[0] : data;
      console.log(`✅ [ExpirySweep] Completed (${reason}) →`, result);
    } catch (e) {
      console.error(`❌ [ExpirySweep] Exception (${reason}):`, e);
    }
  };
  // Run once on startup (delayed slightly to ensure DB is ready)
  setTimeout(() => runSweep('startup'), 5000);
  // Schedule periodic sweeps
  setInterval(() => runSweep('interval'), SWEEP_MINUTES * 60 * 1000);
})();

// Test endpoint for FCM status (no auth required)
app.get("/test-fcm", (req, res) => {
  try {
    const fcmService = require('./services/fcmService');
    res.json({
      success: true,
      fcmInitialized: fcmService.initialized,
      message: fcmService.initialized ? 'FCM service is initialized' : 'FCM service is not initialized'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint for realtime messaging (after security middleware)
app.post("/test-message", async (req, res) => {
  try {
    const { conversationId, senderId, receiverId, message } = req.body;

    if (!conversationId || !senderId || !receiverId || !message) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: conversationId, senderId, receiverId, message"
      });
    }

    const io = app.get("io");
    if (!io) {
      return res.status(500).json({
        success: false,
        error: "Socket.IO not available"
      });
    }

    // Get conversation context
    const { supabaseAdmin } = require('./supabase/client');
    const { data: conversation, error: convError } = await supabaseAdmin
      .from("conversations")
      .select("id, chat_status, flow_state, awaiting_role, campaign_id, current_action_data")
      .eq("id", conversationId)
      .single();

    if (convError) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch conversation context"
      });
    }

    // Prepare conversation context
    const conversationContext = conversation ? {
      id: conversation.id,
      chat_status: conversation.chat_status,
      flow_state: conversation.flow_state,
      awaiting_role: conversation.awaiting_role,
      conversation_type: conversation.campaign_id ? 'campaign' : 'direct',
      current_action_data: conversation.current_action_data
    } : null;

    // Create test message object
    const testMessage = {
      id: `test_${Date.now()}`,
      conversation_id: conversationId,
      sender_id: senderId,
      receiver_id: receiverId,
      message: message,
      created_at: new Date().toISOString(),
      seen: false
    };

    // Emit to conversation room
    console.log(`📡 [TEST] Emitting new_message to room:${conversationId}`);
    io.to(`room:${conversationId}`).emit("new_message", {
      conversation_id: conversationId,
      message: testMessage,
      conversation_context: conversationContext,
    });

    // Emit notification to receiver
    console.log(`📡 [TEST] Emitting notification to user_${receiverId}`);
    io.to(`user_${receiverId}`).emit("notification", {
      type: "message",
      data: {
        conversation_id: conversationId,
        message: testMessage,
        conversation_context: conversationContext,
        sender_id: senderId,
        receiver_id: receiverId,
      },
    });

    // Emit to sender for confirmation
    console.log(`📡 [TEST] Emitting message_sent to user_${senderId}`);
    io.to(`user_${senderId}`).emit("message_sent", {
      conversation_id: conversationId,
      message: testMessage,
      conversation_context: conversationContext,
    });

    // Emit conversation list updates
    console.log(`📡 [TEST] Emitting conversation_list_updated to both users`);
    io.to(`user_${senderId}`).emit('conversation_list_updated', {
      conversation_id: conversationId,
      message: testMessage,
      conversation_context: conversationContext,
      action: 'message_sent'
    });

    io.to(`user_${receiverId}`).emit('conversation_list_updated', {
      conversation_id: conversationId,
      message: testMessage,
      conversation_context: conversationContext,
      action: 'message_received'
    });

    // Emit unread count update
    console.log(`📡 [TEST] Emitting unread_count_updated to user_${receiverId}`);
    io.to(`user_${receiverId}`).emit('unread_count_updated', {
      conversation_id: conversationId,
      unread_count: 1,
      action: 'increment'
    });

    // Send FCM push notification
    console.log(`📱 [TEST] Sending FCM notification to user_${receiverId}`);
    const fcmService = require('./services/fcmService');
    fcmService.sendMessageNotification(
      conversationId,
      testMessage,
      senderId,
      receiverId
    ).then(result => {
      if (result.success) {
        console.log(`✅ [TEST] FCM notification sent: ${result.sent} successful, ${result.failed} failed`);
      } else {
        console.error(`❌ [TEST] FCM notification failed:`, result.error);
      }
    }).catch(error => {
      console.error(`❌ [TEST] FCM notification error:`, error);
    });

    res.json({
      success: true,
      message: "Test message events emitted successfully",
      testMessage,
      conversationContext,
      events: [
        'new_message',
        'notification',
        'message_sent',
        'conversation_list_updated',
        'unread_count_updated',
        'fcm_notification'
      ]
    });

  } catch (error) {
    console.error("❌ [TEST] Error in test-message endpoint:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Webhook routes (no auth required)
const { SubscriptionController } = require("./controllers/subscriptionController");
app.post("/webhook/razorpay", SubscriptionController.handleWebhook);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use("/api/requests", requestRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/fcm", fcmRoutes);
app.use("/api/attachments", attachmentRoutes);
app.use("/api/storage", directStorageRoutes);
app.use("/api/admin/payments", adminPaymentRoutes);
app.use("/api/admin/wallet", adminWalletRoutes);
app.use("/api/wallet", enhancedWalletRoutes);
app.use("/api/admin/settings", adminSettingsRoutes);
app.use("/api/admin/commission-settings", commissionSettingsRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/social-platforms", socialPlatformRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/influencers", influencerRoutes);


// 404 handler for API routes
app.use("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

// Global 404 handler (after all routes)
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Socket.IO setup
const messageHandler = new MessageHandler(io);

// Connect messageHandler to notificationService for online status checking
const notificationService = require('./services/notificationService');
notificationService.setMessageHandler(messageHandler);

io.on("connection", (socket) => {
  messageHandler.handleConnection(socket);

  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, reason: ${reason}`);
    console.log(`📊 Remaining connections: ${io.engine.clientsCount}`);
  });
});

// Add debugging for Socket.IO events
io.engine.on("connection_error", (err) => {
  console.error("❌ [DEBUG] Socket.IO connection error:", err);
});

io.on("error", (err) => {
  console.error("❌ [DEBUG] Socket.IO error:", err);
});

// Monitor connection health and log periodically
setInterval(() => {
  const clients = io.engine.clientsCount;
  if (clients > 0) {
    console.log(`📊 Socket.IO Health Check - Active connections: ${clients}`);
  }
}, 60000); // Log every minute

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
    process.exit(0);
  });
});

// Error handling for uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Stoory Backend server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Network access: http://0.0.0.0:${PORT}/health`);

  // Log WhatsApp configuration (without sensitive data)
  console.log(`📱 WhatsApp Configuration:`, {
    service: process.env.WHATSAPP_SERVICE || "not set",
    endpoint: process.env.WHATSAPP_API_ENDPOINT ? "SET" : "MISSING",
    apiKey: process.env.WHATSAPP_API_KEY ? "SET" : "MISSING",
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || "not set",
  });

  // Set default WhatsApp service if not configured
  if (!process.env.WHATSAPP_SERVICE) {
    console.log('⚠️  WHATSAPP_SERVICE not set, defaulting to "custom"');
    process.env.WHATSAPP_SERVICE = "custom";
  }
});

module.exports = { app, server, io };


