const { supabaseAdmin } = require('../supabase/client');
const fcmService = require('../services/fcmService');

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
            
            // Emit to conversation room
            socket.to(`conversation_${conversationId}`).emit('user_typing', {
                conversationId,
                userId,
                isTyping: true
            });

            // Emit to global update rooms for chat list
            socket.to(`global_${userId}`).emit('typing_status_update', {
                conversation_id: conversationId,
                user_id: userId,
                is_typing: true,
                timestamp: new Date().toISOString()
            });
        });

        socket.on('typing_stop', (data) => {
            const { conversationId, userId } = data;
            this.typingUsers.delete(`${conversationId}_${userId}`);
            
            // Emit to conversation room
            socket.to(`conversation_${conversationId}`).emit('user_typing', {
                conversationId,
                userId,
                isTyping: false
            });

            // Emit to global update rooms for chat list
            socket.to(`global_${userId}`).emit('typing_status_update', {
                conversation_id: conversationId,
                user_id: userId,
                is_typing: false,
                timestamp: new Date().toISOString()
            });
        });

        // Handle sending message
        socket.on('send_message', async (data) => {
            try {
                const { conversationId, senderId, receiverId, message, mediaUrl, attachmentMetadata } = data;
                console.log("🔍 [DEBUG] Socket send_message received:", { conversationId, senderId, receiverId, hasAttachment: !!mediaUrl });

                // Get conversation context first
                const { data: conversation, error: convError } = await supabaseAdmin
                    .from('conversations')
                    .select('id, chat_status, flow_state, awaiting_role, campaign_id, bid_id, automation_enabled, current_action_data')
                    .eq('id', conversationId)
                    .single();

                if (convError) {
                    console.error("❌ [DEBUG] Failed to fetch conversation context:", convError);
                    socket.emit('message_error', { error: 'Failed to fetch conversation context' });
                    return;
                }

                // Prepare message data
                const messageData = {
                    conversation_id: conversationId,
                    sender_id: senderId,
                    receiver_id: receiverId,
                    message: message,
                    media_url: mediaUrl
                };

                // Add attachment metadata if present
                if (attachmentMetadata) {
                    messageData.attachment_metadata = attachmentMetadata;
                }

                // Save message to database
                const { data: savedMessage, error } = await supabaseAdmin
                    .from('messages')
                    .insert(messageData)
                    .select()
                    .single();

                if (error) {
                    console.error("❌ [DEBUG] Failed to save message via socket:", error);
                    socket.emit('message_error', { error: 'Failed to save message' });
                    return;
                }

                console.log("✅ [DEBUG] Message saved via socket, emitting events");

                // Prepare conversation context
                const conversationContext = {
                    id: conversation.id,
                    chat_status: conversation.chat_status,
                    flow_state: conversation.flow_state,
                    awaiting_role: conversation.awaiting_role,
                    conversation_type: conversation.campaign_id ? 'campaign' : 
                                      conversation.bid_id ? 'bid' : 'direct',
                    automation_enabled: conversation.automation_enabled || false,
                    current_action_data: conversation.current_action_data
                };

                // Fetch sender's name for notifications
                let senderName = 'Someone';
                try {
                    const { data: sender, error: senderError } = await supabaseAdmin
                        .from('users')
                        .select('name')
                        .eq('id', senderId)
                        .eq('is_deleted', false)
                        .single();

                    if (!senderError && sender && sender.name) {
                        senderName = sender.name;
                    }
                } catch (error) {
                    console.warn('⚠️ Could not fetch sender name for socket notification:', error.message);
                }

                // Emit message to conversation room with context
                console.log(`📡 [DEBUG] Socket emitting new_message to conversation_${conversationId}`);
                this.io.to(`conversation_${conversationId}`).emit('new_message', {
                    conversation_id: conversationId,
                    message: savedMessage,
                    conversation_context: conversationContext
                });

                // Emit notification to receiver with context
                console.log(`📡 [DEBUG] Socket emitting notification to user_${receiverId}`);
                this.io.to(`user_${receiverId}`).emit('notification', {
                    type: 'message',
                    data: {
                        id: savedMessage.id,
                        title: `${senderName} sent you a message`,
                        body: savedMessage.message,
                        created_at: savedMessage.created_at,
                        conversation_context: conversationContext,
                        payload: { 
                            conversation_id: conversationId, 
                            message_id: savedMessage.id, 
                            sender_id: senderId 
                        },
                        conversation_id: conversationId,
                        message: savedMessage,
                        sender_id: senderId,
                        receiver_id: receiverId
                    }
                });

                // Send FCM push notification
                fcmService.sendMessageNotification(
                    conversationId,
                    savedMessage,
                    senderId,
                    receiverId
                ).then(result => {
                    if (result.success) {
                        console.log(`✅ FCM notification sent: ${result.sent} successful, ${result.failed} failed`);
                    } else {
                        console.error(`❌ FCM notification failed:`, result.error);
                    }
                }).catch(error => {
                    console.error(`❌ FCM notification error:`, error);
                });

                // Emit conversation list update to both users
                console.log(`📡 [DEBUG] Socket emitting conversation_list_updated to both users`);
                this.io.to(`user_${senderId}`).emit('conversation_list_updated', {
                    conversation_id: conversationId,
                    message: savedMessage,
                    conversation_context: conversationContext,
                    action: 'message_sent'
                });
                
                this.io.to(`user_${receiverId}`).emit('conversation_list_updated', {
                    conversation_id: conversationId,
                    message: savedMessage,
                    conversation_context: conversationContext,
                    action: 'message_received'
                });

                // Emit unread count update to receiver
                console.log(`📡 [DEBUG] Socket emitting unread_count_updated to user_${receiverId}`);
                this.io.to(`user_${receiverId}`).emit('unread_count_updated', {
                    conversation_id: conversationId,
                    unread_count: 1, // Increment by 1
                    action: 'increment'
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

        // Handle global conversation list updates
        socket.on('join_global_updates', (userId) => {
            socket.join(`global_${userId}`);
            console.log(`User joined global updates: ${userId}`);
            
            // Emit current online status
            socket.emit('user_status_update', {
                user_id: userId,
                status: 'online',
                timestamp: new Date().toISOString()
            });
        });

        socket.on('leave_global_updates', (userId) => {
            socket.leave(`global_${userId}`);
            console.log(`User left global updates: ${userId}`);
        });

        // Handle conversation list refresh requests
        socket.on('refresh_conversation_list', async (userId) => {
            try {
                // Emit conversation list refresh event
                socket.emit('conversation_list_refresh', {
                    user_id: userId,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                socket.emit('conversation_list_error', { error: error.message });
            }
        });

        // Handle global notification requests
        socket.on('request_global_notifications', (userId) => {
            socket.join(`notifications_${userId}`);
            console.log(`User joined global notifications: ${userId}`);
        });

        socket.on('leave_global_notifications', (userId) => {
            socket.leave(`notifications_${userId}`);
            console.log(`User left global notifications: ${userId}`);
        });

        // Handle message seen
        socket.on('mark_seen', async (data) => {
            try {
                const { messageId, userId, conversationId } = data;

                if (!messageId || !userId || !conversationId) {
                    socket.emit('seen_error', { error: 'Missing required fields: messageId, userId, conversationId' });
                    return;
                }

                // Update message seen status
                const { error } = await supabaseAdmin
                    .from('messages')
                    .update({ seen: true })
                    .eq('id', messageId);

                if (error) {
                    socket.emit('seen_error', { error: 'Failed to mark message as seen' });
                    return;
                }

                // Emit seen status to conversation room
                this.io.to(`conversation_${conversationId}`).emit('message_seen', {
                    messageId,
                    userId,
                    conversationId,
                    timestamp: new Date().toISOString()
                });

                // Emit to global update rooms for real-time chat list updates
                this.io.to(`global_${userId}`).emit('message_seen_update', {
                    messageId,
                    conversationId,
                    timestamp: new Date().toISOString()
                });

                console.log(`✅ Message ${messageId} marked as seen by user ${userId}`);

            } catch (error) {
                console.error('❌ Error marking message as seen:', error);
                socket.emit('seen_error', { error: error.message });
            }
        });

        // Handle attachment upload progress
        socket.on('attachment_upload_progress', (data) => {
            const { conversationId, progress, fileName } = data;
            socket.to(`conversation_${conversationId}`).emit('attachment_upload_progress', {
                conversationId,
                progress,
                fileName,
                timestamp: new Date().toISOString()
            });
        });

        // Handle attachment upload complete
        socket.on('attachment_upload_complete', (data) => {
            const { conversationId, attachment, fileName } = data;
            socket.to(`conversation_${conversationId}`).emit('attachment_upload_complete', {
                conversationId,
                attachment,
                fileName,
                timestamp: new Date().toISOString()
            });
        });

        // Handle attachment upload error
        socket.on('attachment_upload_error', (data) => {
            const { conversationId, error, fileName } = data;
            socket.to(`conversation_${conversationId}`).emit('attachment_upload_error', {
                conversationId,
                error,
                fileName,
                timestamp: new Date().toISOString()
            });
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

    /**
     * Emit conversation state change event
     */
    emitConversationStateChange(conversationId, stateChange) {
        this.io.to(`conversation_${conversationId}`).emit('conversation_state_changed', {
            conversation_id: conversationId,
            previous_state: stateChange.from,
            new_state: stateChange.to,
            reason: stateChange.reason,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get conversation context for emits
     */
    async getConversationContext(conversationId) {
        try {
            const { data: conversation, error } = await supabaseAdmin
                .from('conversations')
                .select('id, chat_status, flow_state, awaiting_role, campaign_id, bid_id, automation_enabled, current_action_data')
                .eq('id', conversationId)
                .single();

            if (error || !conversation) {
                console.error("❌ Failed to fetch conversation context:", error);
                return null;
            }

            return {
                id: conversation.id,
                chat_status: conversation.chat_status,
                flow_state: conversation.flow_state,
                awaiting_role: conversation.awaiting_role,
                conversation_type: conversation.campaign_id ? 'campaign' : 
                                  conversation.bid_id ? 'bid' : 'direct',
                automation_enabled: conversation.automation_enabled || false,
                current_action_data: conversation.current_action_data
            };
        } catch (error) {
            console.error("❌ Error getting conversation context:", error);
            return null;
        }
    }
}

module.exports = MessageHandler; 