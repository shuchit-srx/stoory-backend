const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { ChatService } = require('../services');
const { supabaseAdmin } = require('../db/config');

// Rate limiting configuration - Per-room rate limiting
// Structure: Map<userId, Map<roomName, {count, resetTime}>>
const messageRateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_MESSAGES_PER_WINDOW = 30; // Max 30 messages per minute per room

// Track user's active rooms for reconnection
const userActiveRooms = new Map(); // Map<userId, Set<roomName>>

// Cleanup expired rate limit entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [userId, roomLimits] of messageRateLimits.entries()) {
    for (const [roomName, limits] of roomLimits.entries()) {
      if (now > limits.resetTime) {
        roomLimits.delete(roomName);
      }
    }
    if (roomLimits.size === 0) {
      messageRateLimits.delete(userId);
    }
  }
}, RATE_LIMIT_WINDOW * 2); // Cleanup every 2 minutes

const initSocket = (server) => {
  const io = socketIo(server, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || [
        'http://localhost:3000',
        'http://localhost:5173'
      ],
      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type']
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8 // 100MB for file uploads
  });

  // Authenticate socket connections using JWT token
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      console.error('Socket auth error:', err.message);
      if (err.name === 'TokenExpiredError') {
        return next(new Error('Token expired'));
      }
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.id} (socket: ${socket.id})`);
    
    socket.currentRoom = null;
    socket.userId = socket.user.id;

    // 🔧 OPTIMIZATION: Verify socket is connected before restoring rooms
    // SIGNIFICANCE: Prevents operations on disconnected sockets
    if (socket.connected) {
      const userRooms = userActiveRooms.get(socket.user.id);
      if (userRooms && userRooms.size > 0) {
        userRooms.forEach((roomName) => {
          socket.join(roomName);
          console.log(`User ${socket.user.id} rejoined room ${roomName} on reconnection`);
        });
        socket.currentRoom = Array.from(userRooms)[0];
      }
    }

    // Handle joining a chat room
    socket.on('join_chat', async ({ applicationId }) => {
      try {
        // Validate application ID
        if (!applicationId) {
          return socket.emit('error', {
            message: 'applicationId is required'
          });
        }

        // 🔧 OPTIMIZATION: Verify socket is still connected
        // SIGNIFICANCE: Prevents operations on disconnected sockets
        if (!socket.connected) {
          return socket.emit('error', {
            message: 'Socket connection lost'
          });
        }

        // Check user access to application
        const hasAccess = await ChatService.validateUserAccess(
          socket.user.id,
          applicationId
        );

        if (!hasAccess) {
          return socket.emit('error', {
            message: 'Access denied to this application'
          });
        }

        // Verify chat exists and is active
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

        // Leave previous room if user was in one
        if (socket.currentRoom) {
          socket.leave(socket.currentRoom);
        }

        // Join new room
        socket.join(roomName);
        socket.currentRoom = roomName;

        // Track room membership for reconnection
        if (!userActiveRooms.has(socket.user.id)) {
          userActiveRooms.set(socket.user.id, new Set());
        }
        userActiveRooms.get(socket.user.id).add(roomName);

        console.log(`User ${socket.user.id} joined room ${roomName}`);

        // Notify other users in room
        socket.to(roomName).emit('user_joined', {
          userId: socket.user.id,
          applicationId,
          timestamp: new Date().toISOString()
        });

        // Confirm join to requester
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

    // Handle sending messages
    socket.on('send_message', async (payload, callback) => {
      try {
        const { applicationId, message, attachmentUrl } = payload;

        // Validate required fields
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

        // Validate message length
        if (message.length > 10000) {
          return socket.emit('error', {
            message: 'Message exceeds maximum length of 10000 characters'
          });
        }

        // 🔧 OPTIMIZATION: Verify socket is still connected
        // SIGNIFICANCE: Prevents message sending on disconnected sockets
        if (!socket.connected) {
          return socket.emit('error', {
            message: 'Socket connection lost'
          });
        }

        const roomName = `app_${applicationId}`;

        // Verify user is in room (check before processing)
        if (!socket.rooms.has(roomName)) {
          return socket.emit('error', {
            message: 'You must join the chat room first'
          });
        }

        // Per-room rate limiting
        const now = Date.now();
        if (!messageRateLimits.has(socket.userId)) {
          messageRateLimits.set(socket.userId, new Map());
        }
        const userRoomLimits = messageRateLimits.get(socket.userId);
        const roomLimits = userRoomLimits.get(roomName) || {
          count: 0,
          resetTime: now + RATE_LIMIT_WINDOW
        };

        // Reset window if expired
        if (now > roomLimits.resetTime) {
          roomLimits.count = 0;
          roomLimits.resetTime = now + RATE_LIMIT_WINDOW;
        }

        // Enforce rate limit
        if (roomLimits.count >= MAX_MESSAGES_PER_WINDOW) {
          return socket.emit('error', {
            message: 'Rate limit exceeded. Please wait before sending more messages.'
          });
        }

        roomLimits.count++;
        userRoomLimits.set(roomName, roomLimits);
        messageRateLimits.set(socket.userId, userRoomLimits);

        // Save message to database
        const savedMessage = await ChatService.saveMessage(
          socket.user.id,
          applicationId,
          message,
          attachmentUrl
        );

        // Validate room membership again right before broadcast (prevent race condition)
        if (!socket.rooms.has(roomName)) {
          return socket.emit('error', {
            message: 'You left the chat room. Please rejoin to send messages.'
          });
        }

        // Prepare payload for broadcast (chat_id must be applicationId for frontend)
        const emitPayload = {
          ...savedMessage,
          chat_id: applicationId,
          sender_id: savedMessage.sender_id,
          sender: {
            id: socket.user.id
          }
        };

        // Broadcast message to all users in room
        const roomSockets = await io.in(roomName).fetchSockets();
        const recipientSockets = roomSockets.filter(s => s.userId !== socket.user.id);
        
        console.log(`[Socket] Emitting receive_message to room ${roomName}`, {
          messageId: savedMessage.id,
          chat_id: applicationId,
          sender_id: socket.user.id,
          roomClients: roomSockets.map(s => s.userId),
          roomClientCount: roomSockets.length,
          recipientCount: recipientSockets.length
        });

        io.to(roomName).emit('receive_message', emitPayload);

        // Update message status to DELIVERED for all recipients in the room
        if (recipientSockets.length > 0) {
          try {
            await ChatService.updateMessageStatus(savedMessage.id, 'DELIVERED');
            console.log(`[Socket] Message ${savedMessage.id} marked as DELIVERED to ${recipientSockets.length} recipients`);
            
            // Update unread counts for all recipients
            // savedMessage should have chat_id from the database
            if (savedMessage.chat_id) {
              for (const recipientSocket of recipientSockets) {
                try {
                  const recipientId = recipientSocket.userId;
                  const chatUnreadCount = await ChatService.getUnreadCountForChat(savedMessage.chat_id, recipientId);
                  const totalUnreadData = await ChatService.getTotalUnreadCount(recipientId);

                  // Emit unread count update to recipient
                  io.to(`user_${recipientId}`).emit('unread_count_updated', {
                    chatId: savedMessage.chat_id,
                    unreadCount: chatUnreadCount,
                    totalUnreadCount: totalUnreadData.totalUnreadCount,
                    action: 'increment',
                    timestamp: new Date().toISOString()
                  });
                } catch (unreadError) {
                  console.error(`[Socket] Error updating unread count for recipient ${recipientSocket.userId}:`, unreadError);
                }
              }
            }
          } catch (statusError) {
            console.error('[Socket] Failed to update message status to DELIVERED:', statusError);
          }
        }

        // Acknowledge to sender
        if (callback) {
          callback({
            success: true,
            messageId: savedMessage.id,
            timestamp: savedMessage.created_at,
            status: 'SENT'
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

    // Handle typing indicators
    socket.on('typing', ({ applicationId, isTyping }) => {
      if (!applicationId) {
        return;
      }

      // 🔧 OPTIMIZATION: Verify socket is connected before broadcasting
      // SIGNIFICANCE: Prevents operations on disconnected sockets
      if (!socket.connected) {
        return;
      }

      const roomName = `app_${applicationId}`;

      // Validate user is in room before broadcasting typing status
      if (socket.rooms.has(roomName)) {
        socket.to(roomName).emit('user_typing', {
          userId: socket.user.id,
          isTyping: Boolean(isTyping),
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle marking messages as read
    socket.on('mark_read', async ({ messageId }, callback) => {
      try {
        if (!messageId) {
          return socket.emit('error', {
            message: 'messageId is required'
          });
        }

        // 🔧 OPTIMIZATION: Verify socket is connected
        // SIGNIFICANCE: Prevents operations on disconnected sockets
        if (!socket.connected) {
          return socket.emit('error', {
            message: 'Socket connection lost'
          });
        }

        // Fetch message to get chat and application ID
        const { data: message, error: messageError } = await supabaseAdmin
          .from('v1_chat_messages')
          .select('chat_id, v1_chats(application_id, id)')
          .eq('id', messageId)
          .single();

        if (messageError || !message) {
          return socket.emit('error', {
            message: 'Message not found'
          });
        }

        // Mark message as read (this also updates status to READ)
        const readReceipt = await ChatService.markMessageAsRead(
          messageId,
          socket.user.id
        );

        const chatId = message.chat_id;
        const chatData = message.v1_chats;
        const applicationId = chatData?.application_id;

        // Broadcast read receipt to room
        if (applicationId) {
          const roomName = `app_${applicationId}`;

          io.to(roomName).emit('message_read', {
            messageId,
            userId: socket.user.id,
            readAt: readReceipt.read_at || new Date().toISOString(),
            status: 'READ',
            timestamp: new Date().toISOString()
          });
        }

        // Calculate and emit updated unread count for this chat
        try {
          const chatUnreadCount = await ChatService.getUnreadCountForChat(chatId, socket.user.id);
          const totalUnreadData = await ChatService.getTotalUnreadCount(socket.user.id);

          // Emit unread count update to the user
          socket.emit('unread_count_updated', {
            chatId: chatId,
            unreadCount: chatUnreadCount,
            totalUnreadCount: totalUnreadData.totalUnreadCount,
            action: 'decrement',
            timestamp: new Date().toISOString()
          });
        } catch (unreadError) {
          console.error('[Socket] Error calculating unread count:', unreadError);
          // Don't fail the request if unread count calculation fails
        }

        // Acknowledge to requester
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

    // Handle leaving chat room
    socket.on('leave_chat', (payload = {}) => {
      const { applicationId } = payload;
      const roomName = applicationId ? `app_${applicationId}` : socket.currentRoom;
      
      if (roomName && socket.rooms.has(roomName)) {
        socket.to(roomName).emit('user_left', {
          userId: socket.user.id,
          timestamp: new Date().toISOString()
        });
        socket.leave(roomName);
        
        // Remove from tracked rooms
        const userRooms = userActiveRooms.get(socket.user.id);
        if (userRooms) {
          userRooms.delete(roomName);
          if (userRooms.size === 0) {
            userActiveRooms.delete(socket.user.id);
          }
        }
        
        if (socket.currentRoom === roomName) {
          socket.currentRoom = null;
        }
      }
    });

    // 🔧 CRITICAL CHANGE: Enhanced disconnect handler
    // SIGNIFICANCE: Proper cleanup prevents memory leaks and stale state
    socket.on('disconnect', (reason) => {
      console.log(`User ${socket.user.id} disconnected: ${reason} (socket: ${socket.id})`);
      
      if (socket.currentRoom) {
        socket.to(socket.currentRoom).emit('user_left', {
          userId: socket.user.id,
          timestamp: new Date().toISOString()
        });
      }

      // Cleanup user data when fully disconnected
      const userRooms = userActiveRooms.get(socket.user.id);
      if (userRooms && userRooms.size === 0) {
        messageRateLimits.delete(socket.userId);
        userActiveRooms.delete(socket.user.id);
        console.log(`[Socket] User ${socket.user.id} fully offline, cleaned up`);
      }
    });

    // 🔧 CRITICAL CHANGE: Handle connection errors
    // SIGNIFICANCE: Prevents stale state on errors
    socket.on('error', (error) => {
      console.error(`[Socket] Error for user ${socket.user.id} (socket: ${socket.id}):`, error);
    });
  });

  return io;
};

module.exports = initSocket;
