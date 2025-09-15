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

// Setup security middleware
setupSecurityMiddleware(app);

// Additional middleware
app.use(compression());
app.use(morgan("combined"));

// Make Socket.IO available to controllers
app.set("io", io);

// Set socket for automated flow service
const automatedFlowService = require("./services/automatedFlowService");
automatedFlowService.setSocket(io);

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
  console.log("New client connected:", socket.id);
  messageHandler.handleConnection(socket);
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
