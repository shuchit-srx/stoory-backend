const { supabaseAdmin } = require('../supabase/client');
const fcmService = require('../services/fcmService');
const authService = require('../utils/auth');
const messageController = require('../controllers/messageController');

class MessageHandler {
    constructor(io) {
        this.io = io;
        this.typingUsers = new Map(); // Map to track typing users
        this.onlineUsers = new Map(); // Map to track online users
    }

    /**
     * Authenticate socket connection via JWT
     */
    async authenticateSocket(socket, token, refreshToken = null) {
        try {
            // Strip "Bearer " prefix if present
            const cleanToken = token && token.startsWith('Bearer ') ? token.slice(7) : token;

            let result = authService.verifyToken(cleanToken);

            // If token is invalid/expired and we have a refresh token, try to refresh
            if (!result.success && refreshToken) {
                console.log(`🔄 [SOCKET] Token expired for ${socket.id}, attempting refresh...`);
                const refreshResult = await authService.refreshToken(refreshToken);

                if (refreshResult.success) {
                    console.log(`✅ [SOCKET] Token refreshed successfully for ${socket.id}`);
                    // Verify the new token to get the user object
                    result = authService.verifyToken(refreshResult.token);

                    // If successful, attach new tokens to result so we can send them back
                    if (result.success) {
                        result.newTokens = {
                            token: refreshResult.token,
                            refreshToken: refreshResult.refreshToken
                        };
                    }
                } else {
                    console.warn(`❌ [SOCKET] Token refresh failed for ${socket.id}:`, refreshResult.message);
                }
            }

            if (!result.success) {
                console.warn(`❌ [SOCKET] Token verification failed for ${socket.id}:`, result.message);
                return null;
            }
            socket.user = result.user;
            // Return user and potential new tokens
            return { user: result.user, newTokens: result.newTokens };
        } catch (error) {
            console.error('Socket auth error:', error);
            return null;
        }
    }

    /**
     * Handle socket connection
     */
    handleConnection(socket) {
        console.log(`User connected: ${socket.id}`);

        // Set auth timeout (45 seconds) to allow for slower token refreshes
        const authTimeout = setTimeout(() => {
            if (!socket.user) {
                console.log(`⏱️ [SOCKET] Auth timeout for ${socket.id} - disconnecting`);
                socket.emit('auth_error', { message: 'Authentication timeout' });
                socket.disconnect();
            }
        }, 45000);

        // Check for credentials in handshake (initial connection)
        const handshakeAuth = socket.handshake.auth;
        if (handshakeAuth && (handshakeAuth.token || handshakeAuth.refreshToken)) {
            console.log(`🔐 [SOCKET] Handshake auth detected for ${socket.id}`);
            // We can't use await here directly in the constructor/sync flow easily without being careful,
            // but handleConnection is called synchronously. We'll fire and forget the auth check
            // but since it's async, the timeout covers us if it hangs.
            (async () => {
                const { token, refreshToken } = handshakeAuth;
                const authResult = await this.authenticateSocket(socket, token, refreshToken);

                if (authResult?.user) {
                    clearTimeout(authTimeout);
                    console.log(`⏱️ [SOCKET] Auth timeout cleared (handshake) for ${socket.id}`);

                    socket.user = authResult.user;
                    socket.join(`user_${authResult.user.id}`);
                    this.onlineUsers.set(socket.id, authResult.user.id);

                    if (authResult.newTokens) {
                        console.log(`✨ [SOCKET] Sending new tokens to client ${socket.id} (handshake)`);
                        socket.emit('token_refreshed', authResult.newTokens);
                    }

                    socket.emit('authenticated', { userId: authResult.user.id });
                    console.log(`✅ User ${authResult.user.id} authenticated via handshake on socket ${socket.id}`);
                }
            })();
        }

        // Authenticate on connection
        socket.on('authenticate', async (data) => {
            const { token, refreshToken } = data;
            console.log(`🔐 [SOCKET] authenticate received on ${socket.id} tokenLen:${token ? String(token).length : 0} hasRefresh:${!!refreshToken}`);

            const authResult = await this.authenticateSocket(socket, token, refreshToken);
            const user = authResult?.user;

            // Clear timeout on response (success or fail)
            clearTimeout(authTimeout);
            console.log(`⏱️ [SOCKET] Auth timeout cleared for ${socket.id}`);

            if (user) {
                socket.user = user;
                socket.join(`user_${user.id}`);
                this.onlineUsers.set(socket.id, user.id);

                // If we refreshed the token, send it back to the client
                if (authResult.newTokens) {
                    console.log(`✨ [SOCKET] Sending new tokens to client ${socket.id}`);
                    socket.emit('token_refreshed', authResult.newTokens);
                }

                socket.emit('authenticated', { userId: user.id });
                console.log(`✅ User ${user.id} authenticated on socket ${socket.id}`);
            } else {
                console.warn(`❌ [SOCKET] authentication failed on ${socket.id}:`, authResult === null ? 'Invalid token' : 'Unknown error');
                socket.emit('auth_error', { message: 'Authentication failed' });
                socket.disconnect();
            }
        });

        // Simplified: Join conversation room (chat:join)
        socket.on('chat:join', async ({ conversationId }) => {
            if (!socket.user) {
                socket.emit('chat:error', { message: 'Not authenticated' });
                return;
            }

            try {
                // Verify user has access to this conversation
                const { data: conversation, error } = await supabaseAdmin
                    .from('conversations')
                    .select('brand_owner_id, influencer_id')
                    .eq('id', conversationId)
                    .single();

                if (error || !conversation) {
                    socket.emit('chat:error', { message: 'Conversation not found' });
                    return;
                }

                if (conversation.brand_owner_id !== socket.user.id && conversation.influencer_id !== socket.user.id) {
                    socket.emit('chat:error', { message: 'Access denied' });
                    return;
                }

                socket.join(`room:${conversationId}`);
                socket.join(`app_${conversationId}`); // Backend spec compatibility
                console.log(`📡 [SOCKET] chat:join room:${conversationId} and app_${conversationId} by user:${socket.user.id} sock:${socket.id}`);
                socket.emit('chat:joined', { conversationId });
                socket.emit('joined_chat', { applicationId: conversationId }); // Legacy support
            } catch (error) {
                socket.emit('chat:error', { message: error.message });
            }
        });

        // Legacy: join_chat alias for V1 app compatibility
        socket.on('join_chat', async ({ applicationId }) => {
            console.log(`📡 [SOCKET] Legacy join_chat alias used for applicationId: ${applicationId}`);
            // Map join_chat to chat:join logic
            return socket.emit('chat:join', { conversationId: applicationId });
        });

        // Simplified: Leave conversation room (chat:leave)
        socket.on('chat:leave', ({ conversationId }) => {
            socket.leave(`room:${conversationId}`);
            console.log(`📡 [SOCKET] chat:leave room:${conversationId} by user:${socket.user?.id} sock:${socket.id}`);
        });

        // Join work room for campaign updates (work:join)
        socket.on('work:join', async ({ campaignId }) => {
            if (!socket.user) {
                socket.emit('work:error', { message: 'Not authenticated' });
                return;
            }

            try {
                // Verify user has access (brand owner or influencer)
                const { data: campaign, error } = await supabaseAdmin
                    .from('campaigns')
                    .select('created_by')
                    .eq('id', campaignId)
                    .single();

                const { data: request } = await supabaseAdmin
                    .from('requests')
                    .select('influencer_id')
                    .eq('campaign_id', campaignId)
                    .eq('influencer_id', socket.user.id)
                    .maybeSingle();

                if (!campaign && error) {
                    socket.emit('work:error', { message: 'Campaign not found' });
                    return;
                }

                if (campaign.created_by !== socket.user.id && !request) {
                    socket.emit('work:error', { message: 'Access denied' });
                    return;
                }

                socket.join(`room:work:${campaignId}`);
                console.log(`✅ User ${socket.user.id} joined work room:${campaignId}`);
            } catch (error) {
                socket.emit('work:error', { message: error.message });
            }
        });

        socket.on('work:leave', ({ campaignId }) => {
            socket.leave(`room:work:${campaignId}`);
        });

        // Handle typing indicator
        socket.on('typing_start', (data) => {
            const { conversationId, userId } = data;
            this.typingUsers.set(`${conversationId}_${userId}`, true);

            // Emit to conversation room (spec schema)
            socket.to(`room:${conversationId}`).emit('user_typing', {
                conversation_id: conversationId,
                user_id: userId,
                is_typing: true
            });

            // Legacy room
            socket.to(`app_${conversationId}`).emit('user_typing', {
                userId: userId,
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

            // Emit to conversation room (spec schema)
            socket.to(`room:${conversationId}`).emit('user_typing', {
                conversation_id: conversationId,
                user_id: userId,
                is_typing: false
            });

            // Legacy room
            socket.to(`app_${conversationId}`).emit('user_typing', {
                userId: userId,
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

        // Legacy typing alias
        socket.on('typing', ({ applicationId, isTyping }) => {
            return socket.emit(isTyping ? 'typing_start' : 'typing_stop', {
                conversationId: applicationId,
                userId: socket.user?.id
            });
        });

        // Simplified: Send message (chat:send)
        socket.on('chat:send', async (data) => {
            if (!socket.user) {
                socket.emit('chat:error', { message: 'Not authenticated' });
                return;
            }

            try {
                const { tempId, conversationId, text, attachments, metadata, clientNonce } = data;

                // Check if conversation allows realtime chat
                const { data: conversation, error: convError } = await supabaseAdmin
                    .from('conversations')
                    .select('id, chat_status, flow_state, brand_owner_id, influencer_id, campaign_id, bid_id')
                    .eq('id', conversationId)
                    .single();

                if (convError || !conversation) {
                    socket.emit('chat:error', { message: 'Conversation not found', tempId });
                    return;
                }

                // Allow direct conversations to always send; restrict others to real_time
                const isDirectConversation = !conversation.campaign_id && !conversation.bid_id;
                if (!isDirectConversation && conversation.chat_status !== 'real_time' && conversation.flow_state !== 'real_time') {
                    console.log(`🚫 [CHAT] Blocked chat:send in automated mode conv:${conversationId} sender:${socket.user.id}`);
                    socket.emit('chat:error', {
                        message: 'Chat is in automated mode. Use action buttons to respond.',
                        tempId
                    });
                    return;
                }

                // Determine receiver
                const receiverId = conversation.brand_owner_id === socket.user.id
                    ? conversation.influencer_id
                    : conversation.brand_owner_id;

                // Persist message (idempotency via clientNonce if provided)
                const messageData = {
                    conversation_id: conversationId,
                    sender_id: socket.user.id,
                    receiver_id: receiverId,
                    message: text || '',
                    message_type: 'user_input',
                    attachment_metadata: attachments || metadata || null
                };

                // If clientNonce provided, check for duplicates
                if (clientNonce) {
                    const { data: existing } = await supabaseAdmin
                        .from('messages')
                        .select('id')
                        .eq('conversation_id', conversationId)
                        .eq('sender_id', socket.user.id)
                        .contains('attachment_metadata', { clientNonce })
                        .maybeSingle();

                    if (existing) {
                        // Duplicate detected, return existing message
                        const { data: msg } = await supabaseAdmin
                            .from('messages')
                            .select('*')
                            .eq('id', existing.id)
                            .single();

                        socket.emit('chat:ack', { tempId, message: msg });
                        return;
                    }
                }

                const { data: savedMessage, error: saveError } = await supabaseAdmin
                    .from('messages')
                    .insert(messageData)
                    .select()
                    .single();

                if (saveError) {
                    socket.emit('chat:error', { message: 'Failed to save message', tempId });
                    return;
                }

                // Debug: saved and emit sequence
                console.log(`💾 [CHAT] saved message ${savedMessage.id} conv:${conversationId} sender:${socket.user.id} -> receiver:${receiverId}`);

                // Emit ack to sender
                console.log(`➡️ [EMIT] chat:ack -> sock:${socket.id} tempId:${tempId} msg:${savedMessage.id}`);
                socket.emit('chat:ack', { tempId, message: savedMessage });

                // Broadcast to room: chat:new with { message }
                console.log(`➡️ [EMIT] chat:new -> room:${conversationId} msg:${savedMessage.id}`);
                this.io.to(`room:${conversationId}`).emit('chat:new', { message: savedMessage });
                this.io.to(`app_${conversationId}`).emit('chat:new', { message: savedMessage });

                // Legacy: Emit receive_message for V1 app compatibility
                console.log(`➡️ [EMIT] receive_message -> app_${conversationId} msg:${savedMessage.id}`);
                this.io.to(`app_${conversationId}`).emit('receive_message', savedMessage);
                this.io.to(`room:${conversationId}`).emit('receive_message', savedMessage);

                // Update conversation list for both users with standardized conversations:upsert
                try {
                    const conversationListUtils = require('../utils/conversationListUpdates');

                    // Fetch full conversation for updated_at timestamp
                    const { data: fullConversation } = await supabaseAdmin
                        .from('conversations')
                        .select('*')
                        .eq('id', conversationId)
                        .single();

                    // Build and emit for sender
                    const senderPayload = await conversationListUtils.buildConversationsUpsertPayload({
                        conversationId,
                        currentUserId: socket.user.id,
                        lastMessage: savedMessage,
                        conversation: fullConversation || conversation
                    });
                    conversationListUtils.emitConversationsUpsert(this.io, socket.user.id, senderPayload);

                    // Build and emit for receiver (increment unread count)
                    const receiverPayload = await conversationListUtils.buildConversationsUpsertPayload({
                        conversationId,
                        currentUserId: receiverId,
                        lastMessage: savedMessage,
                        conversation: fullConversation || conversation
                    });
                    conversationListUtils.emitConversationsUpsert(this.io, receiverId, receiverPayload);

                    // Also emit unread_count_updated for receiver
                    if (receiverPayload.unread_count > 0) {
                        conversationListUtils.emitUnreadCountUpdated(
                            this.io,
                            receiverId,
                            conversationId,
                            receiverPayload.unread_count,
                            'increment'
                        );
                    }
                } catch (e) {
                    console.warn('conversation_list_updated summary emit failed:', e.message);
                }

                // Fetch sender's name for notification
                let senderName = 'Someone';
                try {
                    const { data: sender, error: senderError } = await supabaseAdmin
                        .from('users')
                        .select('name')
                        .eq('id', socket.user.id)
                        .eq('is_deleted', false)
                        .single();

                    if (!senderError && sender && sender.name) {
                        senderName = sender.name;
                    }
                } catch (error) {
                    console.warn('⚠️ Could not fetch sender name for socket notification:', error.message);
                }

                // Store notification in database
                const notificationService = require('../services/notificationService');

                // Check if receiver is online
                const isReceiverOnline = this.isUserOnline(receiverId);

                notificationService.storeNotification({
                    user_id: receiverId,
                    type: 'message',
                    title: `${senderName} sent you a message`,
                    message: savedMessage.message,
                    data: {
                        conversation_id: conversationId,
                        message: savedMessage,
                        sender_id: socket.user.id,
                        receiver_id: receiverId,
                        sender_name: senderName
                    },
                    action_url: `/conversations/${conversationId}`
                }, isReceiverOnline ? this.io : null).catch(error => { // Only emit socket event if online
                    console.error('❌ Error storing socket message notification:', error);
                });

                // Send FCM notification only if user is offline
                if (!isReceiverOnline) {
                    fcmService.sendMessageNotification(
                        conversationId,
                        savedMessage,
                        socket.user.id,
                        receiverId,
                        this.io  // Pass io to check if user is in conversation room
                    ).then(result => {
                        if (result.success && !result.skipped) {
                            console.log(`✅ FCM notification sent: ${result.sent} successful`);
                        } else if (result.skipped) {
                            console.log(`ℹ️ [FCM] Skipped - user is viewing conversation`);
                        }
                    }).catch(err => console.error('FCM error:', err));
                }

            } catch (error) {
                console.error('chat:send error:', error);
                socket.emit('chat:error', { message: error.message, tempId: data.tempId });
            }
        });

        // Legacy send_message alias
        socket.on('send_message', (data, callback) => {
            console.log(`➡️ [SOCKET] Legacy send_message alias used:`, data);
            // Map V1 send_message to chat:send logic
            const mappedData = {
                tempId: data.tempId || `temp_v1_${Date.now()}`,
                conversationId: data.applicationId || data.conversationId,
                text: data.message,
                attachments: data.attachmentUrl ? [{ url: data.attachmentUrl }] : null
            };

            // If callback provided, listen for ack
            if (typeof callback === 'function') {
                socket.once('chat:ack', (payload) => {
                    if (payload.tempId === mappedData.tempId) {
                        callback({
                            success: true,
                            messageId: payload.message?.id,
                            timestamp: payload.message?.created_at
                        });
                    }
                });
            }

            return socket.emit('chat:send', mappedData);
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

        // Simplified: Mark messages as read (chat:read)
        socket.on('chat:read', async (data) => {
            if (!socket.user) {
                socket.emit('chat:error', { message: 'Not authenticated' });
                return;
            }

            try {
                const { conversationId, messageIds, upToMessageId } = data;
                console.log(`👁️ [READ] chat:read conv:${conversationId} upTo:${upToMessageId || 'n/a'} ids:${Array.isArray(messageIds) ? messageIds.length : 0} by user:${socket.user.id}`);

                if (!conversationId) {
                    socket.emit('chat:error', { message: 'conversationId required' });
                    return;
                }

                // Verify access
                const { data: conversation } = await supabaseAdmin
                    .from('conversations')
                    .select('brand_owner_id, influencer_id')
                    .eq('id', conversationId)
                    .single();

                if (!conversation ||
                    (conversation.brand_owner_id !== socket.user.id &&
                        conversation.influencer_id !== socket.user.id)) {
                    socket.emit('chat:error', { message: 'Access denied' });
                    return;
                }

                // If upToMessageId provided, mark all messages up to that ID as read
                if (upToMessageId) {
                    // Get the timestamp of the target message
                    const { data: targetMsg } = await supabaseAdmin
                        .from('messages')
                        .select('created_at')
                        .eq('id', upToMessageId)
                        .single();

                    if (targetMsg) {
                        const { error } = await supabaseAdmin
                            .from('messages')
                            .update({ seen: true })
                            .eq('conversation_id', conversationId)
                            .eq('receiver_id', socket.user.id)
                            .lte('created_at', targetMsg.created_at);

                        if (!error) {
                            console.log(`➡️ [EMIT] chat:read -> room:${conversationId} upTo:${upToMessageId} reader:${socket.user.id}`);
                            const readPayload = {
                                conversation_id: conversationId,
                                messageIds: [],
                                upToMessageId,
                                readerId: socket.user.id,
                                readAt: new Date().toISOString()
                            };
                            this.io.to(`room:${conversationId}`).emit('chat:read', readPayload);
                            this.io.to(`app_${conversationId}`).emit('chat:read', readPayload);

                            // Legacy format
                            this.io.to(`app_${conversationId}`).emit('message_read', {
                                applicationId: conversationId,
                                messageId: upToMessageId,
                                readerId: socket.user.id
                            });
                        }
                    } else if (messageIds && messageIds.length > 0) {
                        // Mark specific messages as read
                        const { error } = await supabaseAdmin
                            .from('messages')
                            .update({ seen: true })
                            .in('id', messageIds)
                            .eq('conversation_id', conversationId)
                            .eq('receiver_id', socket.user.id);

                        if (!error) {
                            console.log(`➡️ [EMIT] chat:read -> room:${conversationId} ids:${messageIds.length} reader:${socket.user.id}`);
                            const readPayload = {
                                conversation_id: conversationId,
                                messageIds,
                                readerId: socket.user.id,
                                readAt: new Date().toISOString()
                            };
                            this.io.to(`room:${conversationId}`).emit('chat:read', readPayload);
                            this.io.to(`app_${conversationId}`).emit('chat:read', readPayload);

                            // Legacy format (pick last)
                            this.io.to(`app_${conversationId}`).emit('message_read', {
                                applicationId: conversationId,
                                messageId: messageIds[messageIds.length - 1],
                                readerId: socket.user.id
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('chat:read error:', error);
                socket.emit('chat:error', { message: error.message, conversationId, messageIds, upToMessageId });
            }
        });

        // Legacy mark_read alias
        socket.on('mark_read', (data, callback) => {
            const mappedData = {
                conversationId: data.conversationId, // Mark read needs conv ID in new spec
                upToMessageId: data.messageId
            };
            if (typeof callback === 'function') {
                callback({ success: true });
            }
            return socket.emit('chat:read', mappedData);
        });

        // Handle attachment upload progress
        socket.on('attachment_upload_progress', (data) => {
            const { conversationId, progress, fileName } = data;
            socket.to(`room:${conversationId}`).emit('attachment_upload_progress', {
                conversationId,
                progress,
                fileName,
                timestamp: new Date().toISOString()
            });
        });

        // Handle attachment upload complete
        socket.on('attachment_upload_complete', (data) => {
            const { conversationId, attachment, fileName } = data;
            socket.to(`room:${conversationId}`).emit('attachment_upload_complete', {
                conversationId,
                attachment,
                fileName,
                timestamp: new Date().toISOString()
            });
        });

        // Handle attachment upload error
        socket.on('attachment_upload_error', (data) => {
            const { conversationId, error, fileName } = data;
            socket.to(`room:${conversationId}`).emit('attachment_upload_error', {
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
     * Get list of all online users
     */
    getOnlineUsers() {
        return Array.from(this.onlineUsers.values());
    }

    /**
     * Get online users with socket info
     */
    getOnlineUsersWithSockets() {
        const users = [];
        for (const [socketId, userId] of this.onlineUsers) {
            users.push({
                socketId,
                userId,
                room: `user_${userId}`
            });
        }
        return users;
    }

    /**
     * Emit conversation state change event
     */
    emitConversationStateChange(conversationId, stateChange) {
        this.io.to(`room:${conversationId}`).emit('conversation_state_changed', {
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
                .select('id, chat_status, flow_state, awaiting_role, campaign_id, bid_id, current_action_data')
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

                current_action_data: conversation.current_action_data
            };
        } catch (error) {
            console.error("❌ Error getting conversation context:", error);
            return null;
        }
    }
}

module.exports = MessageHandler; 