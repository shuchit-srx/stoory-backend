const { supabaseAdmin } = require('../supabase/client');

class MessageHandler {
    constructor(io) {
        this.io = io;
        this.typingUsers = new Map(); // Map to track typing users
        this.onlineUsers = new Map(); // Map to track online users
    }

    /**
     * Handle socket connection
     */
    handleConnection(socket) {
        console.log(`User connected: ${socket.id}`);

        // Join user to their personal room
        socket.on('join', (userId) => {
            socket.join(`user_${userId}`);
            this.onlineUsers.set(socket.id, userId);
            console.log(`User ${userId} joined room: user_${userId}`);
        });

        // Handle joining conversation room
        socket.on('join_conversation', (conversationId) => {
            socket.join(`conversation_${conversationId}`);
            console.log(`User joined conversation: ${conversationId}`);
        });

        // Handle leaving conversation room
        socket.on('leave_conversation', (conversationId) => {
            socket.leave(`conversation_${conversationId}`);
            console.log(`User left conversation: ${conversationId}`);
        });

        // Handle typing indicator
        socket.on('typing_start', (data) => {
            const { conversationId, userId } = data;
            this.typingUsers.set(`${conversationId}_${userId}`, true);
            socket.to(`conversation_${conversationId}`).emit('user_typing', {
                conversationId,
                userId,
                isTyping: true
            });
        });

        socket.on('typing_stop', (data) => {
            const { conversationId, userId } = data;
            this.typingUsers.delete(`${conversationId}_${userId}`);
            socket.to(`conversation_${conversationId}`).emit('user_typing', {
                conversationId,
                userId,
                isTyping: false
            });
        });

        // Handle sending message
        socket.on('send_message', async (data) => {
            try {
                const { conversationId, senderId, receiverId, message, mediaUrl } = data;

                // Save message to database
                const { data: savedMessage, error } = await supabaseAdmin
                    .from('messages')
                    .insert({
                        conversation_id: conversationId,
                        sender_id: senderId,
                        receiver_id: receiverId,
                        message: message,
                        media_url: mediaUrl
                    })
                    .select()
                    .single();

                if (error) {
                    socket.emit('message_error', { error: 'Failed to save message' });
                    return;
                }

                // Emit message to conversation room
                this.io.to(`conversation_${conversationId}`).emit('new_message', {
                    message: savedMessage,
                    conversationId
                });

                // Emit notification to receiver
                socket.to(`user_${receiverId}`).emit('message_notification', {
                    message: savedMessage,
                    senderId
                });

                // Stop typing indicator
                this.typingUsers.delete(`${conversationId}_${senderId}`);
                socket.to(`conversation_${conversationId}`).emit('user_typing', {
                    conversationId,
                    userId: senderId,
                    isTyping: false
                });

            } catch (error) {
                socket.emit('message_error', { error: error.message });
            }
        });

        // Handle joining bid/campaign room for real-time updates
        socket.on('join_bid_room', (bidId) => {
            socket.join(`bid_${bidId}`);
            console.log(`User joined bid room: ${bidId}`);
        });

        socket.on('join_campaign_room', (campaignId) => {
            socket.join(`campaign_${campaignId}`);
            console.log(`User joined campaign room: ${campaignId}`);
        });

        socket.on('leave_bid_room', (bidId) => {
            socket.leave(`bid_${bidId}`);
            console.log(`User left bid room: ${bidId}`);
        });

        socket.on('leave_campaign_room', (campaignId) => {
            socket.leave(`campaign_${campaignId}`);
            console.log(`User left campaign room: ${campaignId}`);
        });

        // Handle message seen
        socket.on('mark_seen', async (data) => {
            try {
                const { messageId, userId } = data;

                // Update message seen status
                const { error } = await supabaseAdmin
                    .from('messages')
                    .update({ seen: true })
                    .eq('id', messageId);

                if (error) {
                    socket.emit('seen_error', { error: 'Failed to mark message as seen' });
                    return;
                }

                // Emit seen status to conversation
                socket.to(`conversation_${data.conversationId}`).emit('message_seen', {
                    messageId,
                    userId
                });

            } catch (error) {
                socket.emit('seen_error', { error: error.message });
            }
        });

        // Handle user status
        socket.on('user_status', (data) => {
            const { userId, status } = data;
            socket.broadcast.emit('user_status_change', {
                userId,
                status
            });
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            const userId = this.onlineUsers.get(socket.id);
            if (userId) {
                this.onlineUsers.delete(socket.id);
                socket.broadcast.emit('user_offline', { userId });
            }
            console.log(`User disconnected: ${socket.id}`);
        });
    }

    /**
     * Send notification to user
     */
    sendNotification(userId, notification) {
        this.io.to(`user_${userId}`).emit('notification', notification);
    }

    /**
     * Send notification to multiple users
     */
    sendNotificationToUsers(userIds, notification) {
        userIds.forEach(userId => {
            this.sendNotification(userId, notification);
        });
    }

    /**
     * Broadcast campaign update
     */
    broadcastCampaignUpdate(campaignId, update) {
        this.io.emit('campaign_update', {
            campaignId,
            update
        });
    }

    /**
     * Broadcast request update
     */
    broadcastRequestUpdate(requestId, update) {
        this.io.emit('request_update', {
            requestId,
            update
        });
    }

    /**
     * Get online users count
     */
    getOnlineUsersCount() {
        return this.onlineUsers.size;
    }

    /**
     * Check if user is online
     */
    isUserOnline(userId) {
        return Array.from(this.onlineUsers.values()).includes(userId);
    }
}

module.exports = MessageHandler; 