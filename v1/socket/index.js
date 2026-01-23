const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { ChatService, NotificationService } = require('../services');
const { supabaseAdmin } = require('../db/config');

// Rate limiting: Track message counts per user
const messageRateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_MESSAGES_PER_WINDOW = 30; // Max 30 messages per minute

// Cleanup rate limiting map periodically to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [userId, limits] of messageRateLimits.entries()) {
    // Remove entries that are past their reset time
    if (now > limits.resetTime) {
      messageRateLimits.delete(userId);
    }
  }
}, RATE_LIMIT_WINDOW * 2); // Cleanup every 2 minutes

const initSocket = (server) => {
  const io = socketIo(server, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",") || [
        "http://localhost:3000",
        "http://localhost:5173"
      ],
      methods: ["GET", "POST"],
      credentials: true,
      allowedHeaders: ["Authorization", "Content-Type"]
    },
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8 // 100MB for file uploads
  });

  // Attach io to notification service
  NotificationService.setSocketIO(io);

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      console.error("Socket auth error:", err.message);
      if (err.name === 'TokenExpiredError') {
        return next(new Error("Token expired"));
      }
      next(new Error("Invalid token"));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.id}`);
    NotificationService.registerOnlineUser(socket.user.id, socket.id);
    
    // Track user's current room
    socket.currentRoom = null;
    socket.userId = socket.user.id;

    // Join chat room
    socket.on('join_chat', async ({ applicationId }) => {
      try {
        if (!applicationId) {
          return socket.emit('error', { 
            message: 'applicationId is required' 
          });
        }

        // Validate access
        const hasAccess = await ChatService.validateUserAccess(
          socket.user.id, 
          applicationId
        );
        
        if (!hasAccess) {
          return socket.emit('error', { 
            message: 'Access denied to this application' 
          });
        }

        // Check if chat exists and is active
        const chat = await ChatService.getChatByApplication(applicationId);
        if (!chat) {
          return socket.emit('error', { 
            message: 'Chat not found for this application' 
          });
        }

        if (chat.status !== 'ACTIVE') {
          return socket.emit('error', { 
            message: 'Chat is closed' 
          });
        }

        const roomName = `app_${applicationId}`;
        
        // Leave previous room if any
        if (socket.currentRoom) {
          socket.leave(socket.currentRoom);
        }
        
        socket.join(roomName);
        socket.currentRoom = roomName;
        
        console.log(`User ${socket.user.id} joined room ${roomName}`);
        
        // Notify others
        socket.to(roomName).emit('user_joined', {
          userId: socket.user.id,
          applicationId,
          timestamp: new Date().toISOString()
        });

        // Acknowledge join
        socket.emit('joined_chat', {
          applicationId,
          roomName
        });
      } catch (error) {
        console.error('Join chat error:', error);
        socket.emit('error', { 
          message: error.message || 'Failed to join chat' 
        });
      }
    });

    // Send message
    socket.on('send_message', async (payload, callback) => {
      try {
        const { applicationId, message, attachmentUrl } = payload;
        
        // Validation
        if (!applicationId) {
          return socket.emit('error', { 
            message: 'applicationId is required' 
          });
        }

        if (!message || typeof message !== 'string' || !message.trim()) {
          return socket.emit('error', { 
            message: 'message is required and must be a non-empty string' 
          });
        }

        // Message length validation
        if (message.length > 10000) {
          return socket.emit('error', { 
            message: 'Message exceeds maximum length of 10000 characters' 
          });
        }

        // Rate limiting
        const now = Date.now();
        const userLimits = messageRateLimits.get(socket.userId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
        
        if (now > userLimits.resetTime) {
          // Reset window
          userLimits.count = 0;
          userLimits.resetTime = now + RATE_LIMIT_WINDOW;
        }

        if (userLimits.count >= MAX_MESSAGES_PER_WINDOW) {
          return socket.emit('error', { 
            message: 'Rate limit exceeded. Please wait before sending more messages.' 
          });
        }

        userLimits.count++;
        messageRateLimits.set(socket.userId, userLimits);

        // Check if in room
        if (!socket.rooms.has(`app_${applicationId}`)) {
          return socket.emit('error', { 
            message: 'You must join the chat room first' 
          });
        }

        // Save message
        const savedMessage = await ChatService.saveMessage(
          socket.user.id,
          applicationId,
          message,
          attachmentUrl
        );

        // Broadcast to room (including sender)
        // IMPORTANT: chat_id must be applicationId (not chat.id) to match frontend expectations
        const roomName = `app_${applicationId}`;
        const emitPayload = {
          ...savedMessage,
          chat_id: applicationId, // Override chat_id to be applicationId for frontend
          sender_id: savedMessage.sender_id, // Ensure sender_id is present
          sender: {
            id: socket.user.id,
            // Add other user info if needed
          }
        };
        
        // Log for debugging
        const roomSockets = await io.in(roomName).fetchSockets();
        console.log(`[Socket] Emitting receive_message to room ${roomName}`, {
          messageId: savedMessage.id,
          chat_id: applicationId,
          sender_id: socket.user.id,
          roomClients: roomSockets.map(s => s.userId),
          roomClientCount: roomSockets.length
        });
        
        io.to(roomName).emit('receive_message', emitPayload);

        // Acknowledge to sender
        if (callback) {
          callback({ 
            success: true, 
            messageId: savedMessage.id,
            timestamp: savedMessage.created_at
          });
        }
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { 
          message: error.message || 'Failed to send message' 
        });
        if (callback) {
          callback({ 
            success: false, 
            error: error.message 
          });
        }
      }
    });

    // Typing indicator
    socket.on('typing', ({ applicationId, isTyping }) => {
      if (!applicationId) {
        return;
      }

      if (socket.currentRoom && socket.currentRoom === `app_${applicationId}`) {
        socket.to(socket.currentRoom).emit('user_typing', {
          userId: socket.user.id,
          isTyping: Boolean(isTyping),
          timestamp: new Date().toISOString()
        });
      }
    });

    // Mark message as read
    socket.on('mark_read', async ({ messageId }, callback) => {
      try {
        if (!messageId) {
          return socket.emit('error', { 
            message: 'messageId is required' 
          });
        }

        // Get the message first to find the chat room (before marking as read)
        const { data: message, error: messageError } = await supabaseAdmin
          .from('v1_chat_messages')
          .select('chat_id, v1_chats(application_id)')
          .eq('id', messageId)
          .single();

        if (messageError || !message) {
          return socket.emit('error', { 
            message: 'Message not found' 
          });
        }

        // Mark message as read
        const readReceipt = await ChatService.markMessageAsRead(
          messageId,
          socket.user.id
        );

        // Broadcast read receipt to room if we have the application ID
        if (message.v1_chats && message.v1_chats.application_id) {
          const applicationId = message.v1_chats.application_id;
          const roomName = `app_${applicationId}`;

          // Broadcast read receipt to room
          io.to(roomName).emit('message_read', {
            messageId,
            userId: socket.user.id,
            readAt: readReceipt.read_at || new Date().toISOString(),
            timestamp: new Date().toISOString()
          });
        }

        // Acknowledge to sender
        if (callback) {
          callback({ 
            success: true, 
            readReceipt 
          });
        }
      } catch (error) {
        console.error('Mark read error:', error);
        socket.emit('error', { 
          message: error.message || 'Failed to mark message as read' 
        });
        if (callback) {
          callback({ 
            success: false, 
            error: error.message 
          });
        }
      }
    });

    // Leave room
    socket.on('leave_chat', () => {
      if (socket.currentRoom) {
        socket.to(socket.currentRoom).emit('user_left', {
          userId: socket.user.id,
          timestamp: new Date().toISOString()
        });
        socket.leave(socket.currentRoom);
        socket.currentRoom = null;
      }
    });

    // Disconnect handler
    socket.on('disconnect', (reason) => {
      console.log(`User ${socket.user.id} disconnected: ${reason}`);
      NotificationService.unregisterOnlineUser(socket.user.id, socket.id);
      
      if (socket.currentRoom) {
        socket.to(socket.currentRoom).emit('user_left', {
          userId: socket.user.id,
          timestamp: new Date().toISOString()
        });
      }

      // Cleanup
      messageRateLimits.delete(socket.userId);
    });
  });

  return io;
};

module.exports = initSocket;