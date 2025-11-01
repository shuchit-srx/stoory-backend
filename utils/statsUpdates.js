/**
 * Utility functions for emitting real-time stats updates via socket events
 * Stats calculation EXACTLY matches listing endpoint logic
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * Calculate bids stats for influencer - EXACTLY matches listing logic
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Stats object
 */
async function getBidsStatsForInfluencer(userId) {
  // Step 1: Get all requests for this influencer
  const { data: influencerRequests, error: reqError } = await supabaseAdmin
    .from("requests")
    .select("bid_id, status")
    .eq("influencer_id", userId)
    .not("bid_id", "is", null);

  if (reqError) {
    console.error('Error fetching influencer requests:', reqError);
    return { total: 0, open: 0, pending: 0, closed: 0, rejected: 0 };
  }

  const pendingRequestStatuses = [
    "connected",
    "negotiating",
    "paid",
    "finalized",
    "work_submitted",
    "work_approved",
  ];
  const closedRequestStatuses = ["completed", "cancelled"];

  // Step 2: Filter bid IDs by request status (EXACTLY like listing)
  const pendingBidIds = new Set(
    (influencerRequests || [])
      .filter((r) => r.bid_id && pendingRequestStatuses.includes(r.status))
      .map((r) => r.bid_id)
  );

  const closedBidIds = new Set(
    (influencerRequests || [])
      .filter((r) => r.bid_id && closedRequestStatuses.includes(r.status))
      .map((r) => r.bid_id)
  );

  // Step 3: Get counts for each category (EXACTLY like listing queries, but get ALL without pagination)
  
  // "new" (open): ALL open bids (no request filter)
  const { count: openCount } = await supabaseAdmin
    .from("bids")
    .select("*", { count: 'exact', head: true })
    .eq("status", "open");

  // "pending": Bids where request status matches AND bid.status = "pending"
  let pendingCount = 0;
  if (pendingBidIds.size > 0) {
    const { count } = await supabaseAdmin
      .from("bids")
      .select("*", { count: 'exact', head: true })
      .in("id", Array.from(pendingBidIds))
      .eq("status", "pending");
    pendingCount = count || 0;
  }

  // "closed": Bids where request status matches AND bid.status = "closed"
  let closedCount = 0;
  if (closedBidIds.size > 0) {
    const { count } = await supabaseAdmin
      .from("bids")
      .select("*", { count: 'exact', head: true })
      .in("id", Array.from(closedBidIds))
      .eq("status", "closed");
    closedCount = count || 0;
  }

  return {
    total: (openCount || 0) + pendingCount + closedCount,
    open: openCount || 0,
    pending: pendingCount,
    closed: closedCount,
    rejected: 0,
  };
}

/**
 * Calculate bids stats for brand owner - EXACTLY matches listing logic
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Stats object
 */
async function getBidsStatsForBrandOwner(userId) {
  const { count: openCount } = await supabaseAdmin
    .from("bids")
    .select("*", { count: 'exact', head: true })
    .eq("created_by", userId)
    .eq("status", "open");

  const { count: pendingCount } = await supabaseAdmin
    .from("bids")
    .select("*", { count: 'exact', head: true })
    .eq("created_by", userId)
    .eq("status", "pending");

  const { count: closedCount } = await supabaseAdmin
    .from("bids")
    .select("*", { count: 'exact', head: true })
    .eq("created_by", userId)
    .eq("status", "closed");

  return {
    total: (openCount || 0) + (pendingCount || 0) + (closedCount || 0),
    open: openCount || 0,
    pending: pendingCount || 0,
    closed: closedCount || 0,
    rejected: 0,
  };
}

/**
 * Calculate campaigns stats for influencer - EXACTLY matches listing logic
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Stats object
 */
async function getCampaignsStatsForInfluencer(userId) {
  // Step 1: Get all requests for this influencer
  const { data: influencerRequests, error: reqError } = await supabaseAdmin
    .from("requests")
    .select("campaign_id, status")
    .eq("influencer_id", userId)
    .not("campaign_id", "is", null);

  if (reqError) {
    console.error('Error fetching influencer campaign requests:', reqError);
    return {
      total: 0,
      open: 0,
      pending: 0,
      closed: 0,
      rejected: 0,
      active: 0,
      byType: {
        service: { new: 0, pending: 0, closed: 0, total: 0 },
        product: { new: 0, pending: 0, closed: 0, total: 0 }
      }
    };
  }

  const pendingRequestStatuses = [
    "connected",
    "negotiating",
    "paid",
    "finalized",
    "work_submitted",
    "work_approved",
  ];
  const closedRequestStatuses = ["completed", "cancelled"];

  // Step 2: Filter campaign IDs by request status (EXACTLY like listing)
  const pendingCampaignIds = new Set(
    (influencerRequests || [])
      .filter((r) => r.campaign_id && pendingRequestStatuses.includes(r.status))
      .map((r) => r.campaign_id)
  );

  const closedCampaignIds = new Set(
    (influencerRequests || [])
      .filter((r) => r.campaign_id && closedRequestStatuses.includes(r.status))
      .map((r) => r.campaign_id)
  );

  // Step 3: Get counts and data for type breakdown
  
  // "new" (open): ALL open campaigns (no request filter)
  const { count: openCount } = await supabaseAdmin
    .from("campaigns")
    .select("*", { count: 'exact', head: true })
    .eq("status", "open");

  // Get open campaigns for type breakdown
  const { data: openCampaigns } = await supabaseAdmin
    .from("campaigns")
    .select("campaign_type")
    .eq("status", "open");

  // "pending": Campaigns where request status matches AND campaign.status = "pending"
  let pendingCount = 0;
  let pendingCampaignsData = [];
  if (pendingCampaignIds.size > 0) {
    const { count } = await supabaseAdmin
      .from("campaigns")
      .select("*", { count: 'exact', head: true })
      .in("id", Array.from(pendingCampaignIds))
      .eq("status", "pending");
    pendingCount = count || 0;

    const { data: campaigns } = await supabaseAdmin
      .from("campaigns")
      .select("campaign_type")
      .in("id", Array.from(pendingCampaignIds))
      .eq("status", "pending");
    pendingCampaignsData = campaigns || [];
  }

  // "closed": Campaigns where request status matches AND campaign.status = "closed"
  let closedCount = 0;
  let closedCampaignsData = [];
  if (closedCampaignIds.size > 0) {
    const { count } = await supabaseAdmin
      .from("campaigns")
      .select("*", { count: 'exact', head: true })
      .in("id", Array.from(closedCampaignIds))
      .eq("status", "closed");
    closedCount = count || 0;

    const { data: campaigns } = await supabaseAdmin
      .from("campaigns")
      .select("campaign_type")
      .in("id", Array.from(closedCampaignIds))
      .eq("status", "closed");
    closedCampaignsData = campaigns || [];
  }

  // Build stats with type breakdown
  const stats = {
    total: (openCount || 0) + pendingCount + closedCount,
    open: openCount || 0,
    pending: pendingCount,
    closed: closedCount,
    rejected: 0,
    active: 0,
    byType: {
      service: { new: 0, pending: 0, closed: 0, total: 0 },
      product: { new: 0, pending: 0, closed: 0, total: 0 }
    }
  };

  // Count by type
  openCampaigns?.forEach((campaign) => {
    const campaignType = campaign.campaign_type || 'product';
    stats.byType[campaignType].new++;
    stats.byType[campaignType].total++;
  });

  pendingCampaignsData.forEach((campaign) => {
    const campaignType = campaign.campaign_type || 'product';
    stats.byType[campaignType].pending++;
    stats.byType[campaignType].total++;
  });

  closedCampaignsData.forEach((campaign) => {
    const campaignType = campaign.campaign_type || 'product';
    stats.byType[campaignType].closed++;
    stats.byType[campaignType].total++;
  });

  return stats;
}

/**
 * Calculate campaigns stats for brand owner - EXACTLY matches listing logic
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Stats object
 */
async function getCampaignsStatsForBrandOwner(userId) {
  const { count: openCount } = await supabaseAdmin
    .from("campaigns")
    .select("*", { count: 'exact', head: true })
    .eq("created_by", userId)
    .eq("status", "open");

  const { count: pendingCount } = await supabaseAdmin
    .from("campaigns")
    .select("*", { count: 'exact', head: true })
    .eq("created_by", userId)
    .eq("status", "pending");

  const { count: closedCount } = await supabaseAdmin
    .from("campaigns")
    .select("*", { count: 'exact', head: true })
    .eq("created_by", userId)
    .eq("status", "closed");

  // Get all campaigns for type breakdown
  const { data: allCampaigns } = await supabaseAdmin
    .from("campaigns")
    .select("status, campaign_type")
    .eq("created_by", userId);

  const stats = {
    total: (openCount || 0) + (pendingCount || 0) + (closedCount || 0),
    open: openCount || 0,
    pending: pendingCount || 0,
    closed: closedCount || 0,
    rejected: 0,
    active: 0,
    byType: {
      service: { new: 0, pending: 0, closed: 0, total: 0 },
      product: { new: 0, pending: 0, closed: 0, total: 0 }
    }
  };

  // Count by type
  allCampaigns?.forEach((campaign) => {
    const campaignType = campaign.campaign_type || 'product';
    if (campaign.status === "open") {
      stats.byType[campaignType].new++;
      stats.byType[campaignType].total++;
    } else if (campaign.status === "pending") {
      stats.byType[campaignType].pending++;
      stats.byType[campaignType].total++;
    } else if (campaign.status === "closed") {
      stats.byType[campaignType].closed++;
      stats.byType[campaignType].total++;
    }
  });

  return stats;
}

/**
 * Calculate and format bids stats for a user
 * EXACTLY matches listing endpoint logic
 * @param {string} userId - User ID
 * @param {string} role - User role ('brand_owner' or 'influencer')
 * @returns {Promise<Object>} Formatted stats object
 */
async function getBidsStatsForUser(userId, role) {
  try {
    if (role === "brand_owner") {
      return await getBidsStatsForBrandOwner(userId);
    } else if (role === "influencer") {
      return await getBidsStatsForInfluencer(userId);
    } else {
      return { total: 0, open: 0, pending: 0, closed: 0, rejected: 0 };
    }
  } catch (error) {
    console.error('Error calculating bids stats:', error);
    return { total: 0, open: 0, pending: 0, closed: 0, rejected: 0 };
  }
}

/**
 * Calculate and format campaigns stats for a user
 * EXACTLY matches listing endpoint logic
 * @param {string} userId - User ID
 * @param {string} role - User role ('brand_owner' or 'influencer')
 * @returns {Promise<Object>} Formatted stats object
 */
async function getCampaignsStatsForUser(userId, role) {
  try {
    if (role === "brand_owner") {
      return await getCampaignsStatsForBrandOwner(userId);
    } else if (role === "influencer") {
      return await getCampaignsStatsForInfluencer(userId);
    } else {
      return {
        total: 0,
        open: 0,
        pending: 0,
        closed: 0,
        rejected: 0,
        active: 0,
        byType: {
          service: { new: 0, pending: 0, closed: 0, total: 0 },
          product: { new: 0, pending: 0, closed: 0, total: 0 }
        }
      };
    }
  } catch (error) {
    console.error('Error calculating campaigns stats:', error);
    return {
      total: 0,
      open: 0,
      pending: 0,
      closed: 0,
      rejected: 0,
      active: 0,
      byType: {
        service: { new: 0, pending: 0, closed: 0, total: 0 },
        product: { new: 0, pending: 0, closed: 0, total: 0 }
      }
    };
  }
}

/**
 * Emit bids stats update to user's room
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {Object} io - Socket.IO instance
 */
async function emitBidsStatsUpdated(userId, role, io) {
  if (!io || !userId) {
    return;
  }

  try {
    const stats = await getBidsStatsForUser(userId, role);
    
    const roomName = `user_${userId}`;
    console.log(`➡️ [EMIT] bids:stats_updated -> ${roomName}`, stats);
    
    io.to(roomName).emit('bids:stats_updated', {
      user_id: userId,
      stats: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error emitting bids stats:', error);
  }
}

/**
 * Emit campaigns stats update to user's room
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {Object} io - Socket.IO instance
 */
async function emitCampaignsStatsUpdated(userId, role, io) {
  if (!io || !userId) {
    return;
  }

  try {
    const stats = await getCampaignsStatsForUser(userId, role);
    
    const roomName = `user_${userId}`;
    console.log(`➡️ [EMIT] campaigns:stats_updated -> ${roomName}`, stats);
    
    io.to(roomName).emit('campaigns:stats_updated', {
      user_id: userId,
      stats: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error emitting campaigns stats:', error);
  }
}

/**
 * Get user role from database
 * @param {string} userId - User ID
 * @returns {Promise<string>} User role
 */
async function getUserRole(userId) {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return 'influencer'; // default
    }

    return user.role || 'influencer';
  } catch (error) {
    console.error('Error fetching user role:', error);
    return 'influencer';
  }
}

/**
 * Emit stats updates to both users in a conversation
 * @param {string} brandOwnerId - Brand owner user ID
 * @param {string} influencerId - Influencer user ID
 * @param {Object} io - Socket.IO instance
 */
async function emitStatsUpdatesToBothUsers(brandOwnerId, influencerId, io) {
  if (!io) {
    return;
  }

  try {
    // Get roles for both users
    const [brandOwnerRole, influencerRole] = await Promise.all([
      getUserRole(brandOwnerId),
      getUserRole(influencerId)
    ]);

    // Emit stats updates to brand owner
    if (brandOwnerId) {
      await emitBidsStatsUpdated(brandOwnerId, brandOwnerRole, io);
      await emitCampaignsStatsUpdated(brandOwnerId, brandOwnerRole, io);
    }

    // Emit stats updates to influencer
    if (influencerId) {
      await emitBidsStatsUpdated(influencerId, influencerRole, io);
      await emitCampaignsStatsUpdated(influencerId, influencerRole, io);
    }
  } catch (error) {
    console.error('❌ Error emitting stats updates to both users:', error);
  }
}

/**
 * Emit stats updates when a bid is created/updated/deleted
 * @param {string} createdByUserId - User who created the bid
 * @param {Object} io - Socket.IO instance
 */
async function emitBidStatsOnChange(createdByUserId, io) {
  if (!io || !createdByUserId) {
    return;
  }

  try {
    const role = await getUserRole(createdByUserId);
    await emitBidsStatsUpdated(createdByUserId, role, io);
  } catch (error) {
    console.error('❌ Error emitting bid stats on change:', error);
  }
}

/**
 * Emit stats updates when a campaign is created/updated/deleted
 * @param {string} createdByUserId - User who created the campaign
 * @param {Object} io - Socket.IO instance
 */
async function emitCampaignStatsOnChange(createdByUserId, io) {
  if (!io || !createdByUserId) {
    return;
  }

  try {
    const role = await getUserRole(createdByUserId);
    await emitCampaignsStatsUpdated(createdByUserId, role, io);
  } catch (error) {
    console.error('❌ Error emitting campaign stats on change:', error);
  }
}

module.exports = {
  emitBidsStatsUpdated,
  emitCampaignsStatsUpdated,
  emitStatsUpdatesToBothUsers,
  emitBidStatsOnChange,
  emitCampaignStatsOnChange,
  getBidsStatsForUser,
  getCampaignsStatsForUser,
  getUserRole,
};
