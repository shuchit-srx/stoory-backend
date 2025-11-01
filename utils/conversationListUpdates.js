/**
 * Utility functions for conversation list realtime updates
 * Ensures consistent payload structure for conversations:upsert events
 */

const { supabaseAdmin } = require('../supabase/client');

/**
 * Fetch other user information for a conversation
 * @param {string} conversationId - The conversation ID
 * @param {string} currentUserId - The current user's ID
 * @returns {Promise<Object|null>} Other user info or null
 */
async function getOtherUserInfo(conversationId, currentUserId) {
  try {
    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('brand_owner_id, influencer_id')
      .eq('id', conversationId)
      .single();

    if (error || !conversation) {
      return null;
    }

    const otherUserId = 
      conversation.brand_owner_id === currentUserId
        ? conversation.influencer_id
        : conversation.brand_owner_id;

    if (!otherUserId) {
      return null;
    }

    const { data: otherUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, avatar, profile_image_url')
      .eq('id', otherUserId)
      .eq('is_deleted', false)
      .single();

    if (userError || !otherUser) {
      return null;
    }

    return {
      id: otherUser.id,
      name: otherUser.name,
      avatar: otherUser.avatar || null,
      profile_image_url: otherUser.profile_image_url || null
    };
  } catch (error) {
    console.warn('⚠️ Error fetching other user info:', error.message);
    return null;
  }
}

/**
 * Get unread count for a conversation
 * @param {string} conversationId - The conversation ID
 * @param {string} userId - The user ID to check unread for
 * @returns {Promise<number>} Unread count
 */
async function getUnreadCount(conversationId, userId) {
  try {
    const { count, error } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('receiver_id', userId)
      .eq('seen', false);

    if (error) {
      console.warn('⚠️ Error fetching unread count:', error.message);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.warn('⚠️ Error in getUnreadCount:', error.message);
    return 0;
  }
}

/**
 * Build conversations:upsert payload for a conversation
 * @param {Object} params - Parameters
 * @param {string} params.conversationId - Conversation ID
 * @param {string} params.currentUserId - Current user ID (to determine other_user)
 * @param {Object} params.lastMessage - Last message object
 * @param {Object} params.conversation - Conversation object from DB
 * @param {number} [params.unreadCount] - Unread count (will be fetched if not provided)
 * @returns {Promise<Object>} Payload for conversations:upsert
 */
async function buildConversationsUpsertPayload({
  conversationId,
  currentUserId,
  lastMessage,
  conversation,
  unreadCount = null
}) {
  // Fetch other user info
  const otherUser = await getOtherUserInfo(conversationId, currentUserId);

  // Fetch unread count if not provided
  let finalUnreadCount = unreadCount;
  if (finalUnreadCount === null) {
    finalUnreadCount = await getUnreadCount(conversationId, currentUserId);
  }

  // Build last_message object
  const lastMessageObj = lastMessage ? {
    id: lastMessage.id,
    message: lastMessage.message || lastMessage.content,
    created_at: lastMessage.created_at,
    sender_id: lastMessage.sender_id,
    seen: lastMessage.seen || false
  } : null;

  // Build payload
  const payload = {
    conversation_id: conversationId,
    updated_at: conversation?.updated_at || new Date().toISOString(),
    created_at: conversation?.created_at || null,
    chat_status: conversation?.chat_status || null,
    flow_state: conversation?.flow_state || null,
    awaiting_role: conversation?.awaiting_role || null,
    unread_count: finalUnreadCount
  };

  if (otherUser) {
    payload.other_user = otherUser;
  }

  if (lastMessageObj) {
    payload.last_message = lastMessageObj;
  }

  return payload;
}

/**
 * Emit conversations:upsert to a user
 * @param {Object} io - Socket.IO instance
 * @param {string} userId - User ID to emit to
 * @param {Object} payload - Payload from buildConversationsUpsertPayload
 */
function emitConversationsUpsert(io, userId, payload) {
  if (!io || !userId) {
    return;
  }

  const roomName = `user_${userId}`;
  console.log(`➡️ [EMIT] conversations:upsert -> ${roomName} conv:${payload.conversation_id}`);
  io.to(roomName).emit('conversations:upsert', payload);
}

/**
 * Emit conversations:upsert to both participants in a conversation
 * @param {Object} io - Socket.IO instance
 * @param {string} conversationId - Conversation ID
 * @param {Object} conversation - Conversation object from DB
 * @param {Object} lastMessage - Last message object (optional)
 */
async function emitConversationsUpsertToBothUsers(io, conversationId, conversation, lastMessage = null) {
  if (!io || !conversation) {
    return;
  }

  const { brand_owner_id, influencer_id } = conversation;

  // Build payload for brand owner
  const brandOwnerPayload = await buildConversationsUpsertPayload({
    conversationId,
    currentUserId: brand_owner_id,
    lastMessage,
    conversation
  });
  emitConversationsUpsert(io, brand_owner_id, brandOwnerPayload);

  // Build payload for influencer
  const influencerPayload = await buildConversationsUpsertPayload({
    conversationId,
    currentUserId: influencer_id,
    lastMessage,
    conversation
  });
  emitConversationsUpsert(io, influencer_id, influencerPayload);
}

/**
 * Emit unread_count_updated event
 * @param {Object} io - Socket.IO instance
 * @param {string} userId - User ID
 * @param {string} conversationId - Conversation ID
 * @param {number} unreadCount - New unread count
 * @param {string} action - 'increment' | 'decrement' | 'reset'
 */
function emitUnreadCountUpdated(io, userId, conversationId, unreadCount, action = null) {
  if (!io || !userId) {
    return;
  }

  const roomName = `user_${userId}`;
  const payload = {
    conversation_id: conversationId,
    unread_count: unreadCount
  };

  if (action) {
    payload.action = action;
  }

  console.log(`➡️ [EMIT] unread_count_updated -> ${roomName} conv:${conversationId} count:${unreadCount}`);
  io.to(roomName).emit('unread_count_updated', payload);
}

module.exports = {
  getOtherUserInfo,
  getUnreadCount,
  buildConversationsUpsertPayload,
  emitConversationsUpsert,
  emitConversationsUpsertToBothUsers,
  emitUnreadCountUpdated
};

