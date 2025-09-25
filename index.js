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
const bidRoutes = require("./routes/bids");
const requestRoutes = require("./routes/requests");
const conversationRoutes = require("./routes/conversations");
const userRoutes = require("./routes/users");
const messageRoutes = require("./routes/messages");
const paymentRoutes = require("./routes/payments");
const subscriptionRoutes = require("./routes/subscriptions");
const socialPlatformRoutes = require("./routes/socialPlatforms");
const fcmRoutes = require("./routes/fcm");
const couponRoutes = require("./routes/coupons");

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
          /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
          /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
          /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/,
        ],
    methods: ["GET", "POST"],
    credentials: true,
  },
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

// Additional middleware
app.use(compression());
app.use(morgan("combined"));

// Add general request logging
app.use((req, res, next) => {
  console.log("🚀 [DEBUG] Request received:", req.method, req.url);
  next();
});

// Make Socket.IO available to controllers
app.set("io", io);

// Set socket for automated flow service
const automatedFlowService = require("./utils/automatedFlowService");
automatedFlowService.setIO(io);

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
      .select("id, chat_status, flow_state, awaiting_role, campaign_id, bid_id, automation_enabled, current_action_data")
      .eq("id", conversationId)
      .single();

    if (convError) {
      console.error("❌ [DEBUG] Failed to fetch conversation context:", convError);
    }

    // Prepare conversation context
    const conversationContext = conversation ? {
      id: conversation.id,
      chat_status: conversation.chat_status,
      flow_state: conversation.flow_state,
      awaiting_role: conversation.awaiting_role,
      conversation_type: conversation.campaign_id ? 'campaign' : 
                        conversation.bid_id ? 'bid' : 'direct',
      automation_enabled: conversation.automation_enabled || false,
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
    console.log(`📡 [TEST] Emitting new_message to conversation_${conversationId}`);
    io.to(`conversation_${conversationId}`).emit("new_message", {
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
app.use("/api/bids", bidRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/social-platforms", socialPlatformRoutes);
app.use("/api/fcm", fcmRoutes);
app.use("/api/coupons", couponRoutes);

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

io.on("connection", (socket) => {
  console.log("🔌 [DEBUG] New client connected:", socket.id);
  console.log("🔌 [DEBUG] Socket.IO instance available:", !!io);
  messageHandler.handleConnection(socket);
});

// Add debugging for Socket.IO events
io.engine.on("connection_error", (err) => {
  console.error("❌ [DEBUG] Socket.IO connection error:", err);
});

io.on("error", (err) => {
  console.error("❌ [DEBUG] Socket.IO error:", err);
});

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
