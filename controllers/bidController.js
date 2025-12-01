const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult, query } = require("express-validator");
const {
  uploadImageToStorage,
  deleteImageFromStorage,
} = require("../utils/imageUpload");
const automatedFlowService = require("../utils/automatedFlowService");
const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID || "00000000-0000-0000-0000-000000000000";

class BidController {
  /**
   * Enrich bids with influencer's request status
   */
  static async enrichWithRequestStatus(bids, influencerId) {
    if (!bids || !Array.isArray(bids) || bids.length === 0 || !influencerId) {
      return bids;
    }

    const bidIds = bids.map(b => b.id).filter(Boolean);
    if (bidIds.length === 0) {
      return bids;
    }

    // Fetch all requests for this influencer for these bids
    const { data: requests, error } = await supabaseAdmin
      .from("requests")
      .select("id, bid_id, status, proposed_amount, final_agreed_amount, created_at, updated_at")
      .eq("influencer_id", influencerId)
      .in("bid_id", bidIds)
      .not("bid_id", "is", null);

    if (error) {
      console.error("Error fetching request status:", error);
      return bids; // Return bids without enrichment on error
    }

    // Create a map of bid_id -> request
    const requestMap = {};
    requests?.forEach(req => {
      if (req.bid_id && !requestMap[req.bid_id]) {
        // If multiple requests exist, use the most recent one
        const existing = requestMap[req.bid_id];
        if (!existing || new Date(req.created_at) > new Date(existing.created_at)) {
          requestMap[req.bid_id] = req;
        }
      }
    });

    // Map request status to UI-friendly format
    const mapRequestStatus = (status) => {
      if (!status) return "none";

      const pendingStatuses = ["connected", "negotiating", "finalized", "paid", "work_submitted", "work_approved"];
      if (pendingStatuses.includes(status)) return "pending";
      if (status === "completed") return "accepted";
      if (status === "cancelled") return "rejected";
      return "pending"; // Default to pending for unknown statuses
    };

    // Enrich each bid with request status
    return bids.map(bid => {
      const request = requestMap[bid.id];

      if (!request) {
        return {
          ...bid,
          request_status: "none",
          request_id: null,
          influencer_request: null
        };
      }

      return {
        ...bid,
        request_status: mapRequestStatus(request.status),
        request_id: request.id,
        influencer_request: {
          id: request.id,
          status: request.status,
          proposed_amount: request.proposed_amount,
          final_agreed_amount: request.final_agreed_amount,
          created_at: request.created_at,
          updated_at: request.updated_at
        }
      };
    });
  }

  /**
   * Helper function to add influencer count and proposed amount sum to bids
   */
  static addInfluencerStats(bids) {
    if (!bids) return bids;

    const bidsArray = Array.isArray(bids) ? bids : [bids];

    return bidsArray.map(bid => {
      // Extract influencer count from requests_count
      const influencerCount = Array.isArray(bid.requests_count) && bid.requests_count[0] && typeof bid.requests_count[0].count === 'number'
        ? bid.requests_count[0].count
        : 0;

      // Calculate sum of proposed amounts from requests
      const proposedAmountSum = Array.isArray(bid.requests)
        ? bid.requests.reduce((sum, r) => sum + (parseFloat(r.proposed_amount) || 0), 0)
        : 0;

      // Remove the nested requests_count structure and add clean fields
      const { requests_count, requests, ...rest } = bid;

      return {
        ...rest,
        influencer_count: influencerCount,
        proposed_amount_sum: proposedAmountSum
      };
    });
  }

  /**
   * Create a new bid
   */
  async createBid(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const {
        title,
        description,
        min_budget,
        max_budget,
        requirements,
        languages, // Changed from language
        platform,
        content_type,
        categories, // Changed from category
        locations, // Added locations
        expiry_date,
      } = req.body;

      // Handle image upload if present
      let imageUrl = null;
      if (req.file) {
        const { url, error } = await uploadImageToStorage(
          req.file.buffer,
          req.file.originalname,
          "bids"
        );

        if (error) {
          return res.status(500).json({
            success: false,
            message: "Failed to upload image",
            error: error,
          });
        }

        imageUrl = url;
      }

      // Ensure array fields are arrays and normalized to lowercase
      const languagesRaw = Array.isArray(languages) ? languages : (languages ? [languages] : []);
      const categoriesRaw = Array.isArray(categories) ? categories : (categories ? [categories] : []);
      const locationsRaw = Array.isArray(locations) ? locations : (locations ? [locations] : []);

      const languagesArray = languagesRaw.map(v => String(v).toLowerCase());
      const categoriesArray = categoriesRaw.map(v => String(v).toLowerCase());
      const locationsArray = locationsRaw.map(v => String(v).toLowerCase());

      const bidData = {
        title,
        description: description || "",
        min_budget: parseFloat(min_budget),
        max_budget: parseFloat(max_budget),
        requirements: requirements || null,
        languages: languagesArray,
        platform: platform || null,
        content_type: content_type || null,
        categories: categoriesArray,
        locations: locationsArray,
        expiry_date: expiry_date ? new Date(expiry_date).toISOString() : null,
        image_url: imageUrl,
      };

      // Ensure only brand owners can create bids
      if (req.user.role !== "brand_owner" && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can create bids",
        });
      }

      // Check subscription status for brand owners
      if (req.user.role === "brand_owner") {
        const { data: hasPremiumAccess } = await supabaseAdmin.rpc(
          "has_active_premium_subscription",
          {
            user_uuid: userId,
          }
        );

        if (!hasPremiumAccess) {
          return res.status(403).json({
            success: false,
            message: "Premium subscription required to create bids",
            requires_subscription: true,
          });
        }
      }

      const { data: bid, error } = await supabaseAdmin
        .from("bids")
        .insert({
          ...bidData,
          created_by: userId,
        })
        .select()
        .single();

      if (error) {
        console.error("Database error creating bid:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to create bid",
          error: error.message,
        });
      }

      // Emit stats update after bid creation
      const io = req.app.get("io");
      if (io) {
        const { emitBidStatsOnChange } = require('../utils/statsUpdates');
        await emitBidStatsOnChange(userId, io);
      }

      res.status(201).json({
        success: true,
        data: bid,
        message: "Bid created successfully",
      });
    } catch (error) {
      console.error("Exception creating bid:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  /**
   * Get all bids with filtering and pagination
   */
  async getBids(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        min_budget,
        max_budget,
        search,
        // New array filters
        languages,
        locations,
        categories,
      } = req.query;

      const offset = (page - 1) * limit;
      let baseSelect = supabaseAdmin.from("bids").select(`
                    *,
                    created_by_user:users!bids_created_by_fkey (
                        id,
                        name,
                        role,
                        brand_name,
                        profile_image_url
                    ),
                    requests_count:requests(count),
                    requests(proposed_amount)
                `);

      // Import filter helpers
      const { applyCommonFilters } = require('../utils/filterHelpers');

      // Apply common filters (budget, languages, locations, categories, search)
      baseSelect = applyCommonFilters(baseSelect, {
        min_budget,
        max_budget,
        languages,
        locations,
        categories,
        search
      });

      // Role-based server-driven filtering
      if (req.user.role === "influencer") {
        const userId = req.user.id;
        let normalizedStatus = (status || "open").toLowerCase();
        if (normalizedStatus === "new") normalizedStatus = "open";

        // Show all bids with the requested status (Global List)
        let query = baseSelect.eq("status", normalizedStatus);

        const {
          data: bids,
          error,
          count,
        } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          return res
            .status(500)
            .json({ success: false, message: "Failed to fetch bids" });
        }

        const processedBids = BidController.addInfluencerStats(bids || []);

        // Add request status for each bid if user is influencer
        const bidsWithRequestStatus = await BidController.enrichWithRequestStatus(
          processedBids,
          userId
        );

        return res.json({
          success: true,
          bids: bidsWithRequestStatus,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || processedBids.length,
            pages: Math.ceil((count || processedBids.length) / limit),
          },
        });
      } else if (req.user.role === "brand_owner") {
        // Brand owners only see their own bids
        let query = baseSelect.eq("created_by", req.user.id);
        if (status) query = query.eq("status", status);
        const {
          data: bids,
          error,
          count,
        } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (error) {
          return res
            .status(500)
            .json({ success: false, message: "Failed to fetch bids" });
        }
        // Expired visibility: brand_owner sees by default; others only if include_expired=true
        const includeExpired = String(req.query.include_expired || 'false') === 'true';
        const now = new Date();
        const withExpired = (bids || []).map(b => {
          const requestsCount = Array.isArray(b.requests_count) && b.requests_count[0] && typeof b.requests_count[0].count === 'number' ? b.requests_count[0].count : 0;
          const isExpired = (b.status === 'open') && (!requestsCount || requestsCount === 0) && b.expiry_date && (new Date(b.expiry_date) < now);
          return { ...b, __expired: isExpired };
        });
        let visible = withExpired.filter(b => true); // brand_owner sees all
        visible.sort((a, b) => {
          if (a.__expired !== b.__expired) return a.__expired ? 1 : -1;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        const processedBids = BidController.addInfluencerStats(visible);

        // Add request status for each bid if user is influencer
        const bidsWithRequestStatus = req.user.role === "influencer"
          ? await BidController.enrichWithRequestStatus(processedBids, req.user.id)
          : processedBids;

        return res.json({
          success: true,
          bids: bidsWithRequestStatus,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || 0,
            pages: Math.ceil((count || 0) / limit),
          },
        });
      } else {
        // Admin or other roles: generic filters
        let query = baseSelect;
        if (status) query = query.eq("status", status);
        const {
          data: bids,
          error,
          count,
        } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (error) {
          return res
            .status(500)
            .json({ success: false, message: "Failed to fetch bids" });
        }
        const includeExpired = String(req.query.include_expired || 'false') === 'true';
        const now = new Date();
        const withExpired = (bids || []).map(b => {
          const requestsCount = Array.isArray(b.requests_count) && b.requests_count[0] && typeof b.requests_count[0].count === 'number' ? b.requests_count[0].count : 0;
          const isExpired = (b.status === 'open') && (!requestsCount || requestsCount === 0) && b.expiry_date && (new Date(b.expiry_date) < now);
          return { ...b, __expired: isExpired };
        });
        let visible = withExpired.filter(b => includeExpired ? true : !b.__expired);
        visible.sort((a, b) => {
          if (a.__expired !== b.__expired) return a.__expired ? 1 : -1;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        const processedBids = BidController.addInfluencerStats(visible);

        // Add request status for each bid if user is influencer
        const bidsWithRequestStatus = req.user.role === "influencer"
          ? await BidController.enrichWithRequestStatus(processedBids, req.user.id)
          : processedBids;

        return res.json({
          success: true,
          bids: bidsWithRequestStatus,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || 0,
            pages: Math.ceil((count || 0) / limit),
          },
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get a specific bid by ID
   */
  async getBid(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      let query = null;

      if (req.user.role === "influencer") {
        query = supabaseAdmin
          .from("bids")
          .select(
            `
                    *,
                    created_by_user:users!bids_created_by_fkey (
                        id,
                        role
                    ),
                    requests (
                        id,
                        status,
                        proposed_amount,
                        message,
                        created_at,
                        influencer:users!requests_influencer_id_fkey (
                            id,
                            name,
                            role,
                            languages,
                            categories,
                            min_range,
                            max_range,
                            profile_image_url
                        )
                    )
                `
          )
          .eq("id", id);
      } else {
        query = supabaseAdmin
          .from("bids")
          .select(
            `
                    *,
                    created_by_user:users!bids_created_by_fkey (
                        id,
                        role,
                        name,
                        phone,
                        email,
                        profile_image_url
                    ),
                    requests (
                        id,
                        status,
                        proposed_amount,
                        message,
                        created_at,
                        influencer:users!requests_influencer_id_fkey (
                            id,
                            name,
                            role,
                            languages,
                            categories,
                            min_range,
                            max_range,
                            profile_image_url
                        )
                    )
                `
          )
          .eq("id", id);
      }

      const { data: bid, error } = await query.single();

      if (error || !bid) {
        return res.status(404).json({
          success: false,
          message: "Bid not found",
        });
      }

      // Check access permissions
      if (req.user.role === "brand_owner" && bid.created_by !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (req.user.role === "influencer") {
        // Check if influencer has interacted with this bid
        const hasInteraction = bid.requests.some(
          (request) => request.influencer.id === userId
        );
        if (!hasInteraction && bid.status !== "open") {
          return res.status(403).json({
            success: false,
            message: "Access denied",
          });
        }
      }

      res.json({
        success: true,
        bid: bid,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Update a bid
   */
  async updateBid(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const userId = req.user.id;
      const {
        title,
        description,
        min_budget,
        max_budget,
        requirements,
        languages, // Changed from language
        platform,
        content_type,
        categories, // Changed from category
        locations, // Added locations
        expiry_date,
      } = req.body;

      // Handle image upload if present
      let imageUrl = null;
      if (req.file) {
        const { url, error } = await uploadImageToStorage(
          req.file.buffer,
          req.file.originalname,
          "bids"
        );

        if (error) {
          return res.status(500).json({
            success: false,
            message: "Failed to upload image",
            error: error,
          });
        }

        imageUrl = url;
      }

      // Build update data object with only provided fields
      const updateData = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (min_budget !== undefined)
        updateData.min_budget = parseFloat(min_budget);
      if (max_budget !== undefined)
        updateData.max_budget = parseFloat(max_budget);
      if (requirements !== undefined) updateData.requirements = requirements;
      if (languages !== undefined) {
        const langs = Array.isArray(languages) ? languages : (languages ? [languages] : []);
        updateData.languages = langs.map(v => String(v).toLowerCase());
      }
      if (platform !== undefined) updateData.platform = platform;
      if (content_type !== undefined) updateData.content_type = content_type;
      if (categories !== undefined) {
        const cats = Array.isArray(categories) ? categories : (categories ? [categories] : []);
        updateData.categories = cats.map(v => String(v).toLowerCase());
      }
      if (locations !== undefined) {
        const locs = Array.isArray(locations) ? locations : (locations ? [locations] : []);
        updateData.locations = locs.map(v => String(v).toLowerCase());
      }
      if (expiry_date !== undefined)
        updateData.expiry_date = expiry_date
          ? new Date(expiry_date).toISOString()
          : null;
      if (imageUrl !== null) updateData.image_url = imageUrl;

      console.log("Update bid request:", {
        bidId: id,
        userId: userId,
        receivedData: req.body,
        updateData: updateData,
      });

      // Check if bid exists and user has permission
      const { data: existingBid, error: checkError } = await supabaseAdmin
        .from("bids")
        .select("created_by")
        .eq("id", id)
        .single();

      if (checkError || !existingBid) {
        return res.status(404).json({
          success: false,
          message: "Bid not found",
        });
      }

      if (existingBid.created_by !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      const { data: bid, error } = await supabaseAdmin
        .from("bids")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("Database error updating bid:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to update bid",
          error: error.message,
        });
      }

      console.log("Bid updated successfully:", bid);
      res.json({
        success: true,
        bid: bid,
        message: "Bid updated successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete a bid
   */
  async deleteBid(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Check if bid exists and user has permission
      const { data: existingBid, error: checkError } = await supabaseAdmin
        .from("bids")
        .select("created_by, image_url, status")
        .eq("id", id)
        .single();

      if (checkError || !existingBid) {
        return res.status(404).json({
          success: false,
          message: "Bid not found",
        });
      }

      if (existingBid.created_by !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Prevent deletion if bid is pending or closed
      if (["pending", "closed"].includes(existingBid.status)) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete a bid that is pending or closed",
        });
      }

      // Delete associated image if it exists
      if (existingBid.image_url) {
        await deleteImageFromStorage(existingBid.image_url);
      }

      // CASCADE DELETE LOGIC
      // 1. Get all requests for this bid
      const { data: requests } = await supabaseAdmin
        .from("requests")
        .select("id")
        .eq("bid_id", id);

      if (requests && requests.length > 0) {
        const requestIds = requests.map(r => r.id);

        // 2. Get all conversations for these requests
        const { data: conversations } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .in("request_id", requestIds);

        if (conversations && conversations.length > 0) {
          const conversationIds = conversations.map(c => c.id);

          // 3. Delete messages
          await supabaseAdmin
            .from("messages")
            .delete()
            .in("conversation_id", conversationIds);

          // 4. Delete conversations
          await supabaseAdmin
            .from("conversations")
            .delete()
            .in("id", conversationIds);
        }

        // 5. Delete requests
        await supabaseAdmin
          .from("requests")
          .delete()
          .in("id", requestIds);
      }

      const { error } = await supabaseAdmin.from("bids").delete().eq("id", id);

      if (error) {
        console.error("Error deleting bid:", error);
        // Check for foreign key constraint violation
        if (error.code === '23503') {
          return res.status(409).json({
            success: false,
            message: "Cannot delete bid due to associated records (e.g., transactions, agreements).",
          });
        }
        return res.status(500).json({
          success: false,
          message: "Failed to delete bid",
        });
      }

      // Emit stats updates after deletion
      const io = req.app.get("io");
      if (io && existingBid.created_by) {
        const { emitBidStatsOnChange } = require('../utils/statsUpdates');
        await emitBidStatsOnChange(existingBid.created_by, io);
      }

      res.json({
        success: true,
        message: "Bid deleted successfully",
      });
    } catch (error) {
      console.error("Exception in deleteBid:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get bid statistics
   * 
   * For Influencers:
   * - "new": All open bids (status='open')
   * - "pending": Bids where influencer has interacted AND bid.status='pending'
   * - "closed": Bids where influencer has interacted AND bid.status='closed'
   * 
   * For Brand Owners:
   * - "new": All their created bids with status='open'
   * - "pending": Their created bids with status='pending'
   * - "closed": Their created bids with status='closed'
   */
  async getBidStats(req, res) {
    try {
      const userId = req.user.id;
      const { getBidsStatsForUser } = require('../utils/statsUpdates');

      // Use the helper function that reuses listing logic
      const stats = await getBidsStatsForUser(userId, req.user.role);

      // Calculate total budget if needed
      let totalBudget = 0;
      if (req.user.role === "admin") {
        // Admin sees all bids budget
        const { data: allBids } = await supabaseAdmin
          .from("bids")
          .select("min_budget, max_budget");

        allBids?.forEach((bid) => {
          totalBudget += parseFloat(bid.max_budget || bid.min_budget || 0);
        });
      } else if (req.user.role === "brand_owner") {
        const { data: allBids } = await supabaseAdmin
          .from("bids")
          .select("min_budget, max_budget")
          .eq("created_by", userId);

        allBids?.forEach((bid) => {
          totalBudget += parseFloat(bid.max_budget || bid.min_budget || 0);
        });
      } else if (req.user.role === "influencer") {
        // For influencers, calculate budget from all bids in stats
        const allBidIds = new Set();

        // Get open bids
        const { data: openBids } = await supabaseAdmin
          .from("bids")
          .select("id, min_budget, max_budget")
          .eq("status", "open");
        openBids?.forEach(b => {
          allBidIds.add(b.id);
          totalBudget += parseFloat(b.max_budget || b.min_budget || 0);
        });

        // Get pending/closed bids from requests
        const { data: influencerRequests } = await supabaseAdmin
          .from("requests")
          .select("bid_id, status")
          .eq("influencer_id", userId)
          .not("bid_id", "is", null);

        const pendingRequestStatuses = ["connected", "negotiating", "paid", "finalized", "work_submitted", "work_approved"];
        const closedRequestStatuses = ["completed", "cancelled"];

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

        if (pendingBidIds.size > 0) {
          const { data: pendingBids } = await supabaseAdmin
            .from("bids")
            .select("id, min_budget, max_budget")
            .in("id", Array.from(pendingBidIds))
            .eq("status", "pending");
          pendingBids?.forEach(b => {
            if (!allBidIds.has(b.id)) {
              allBidIds.add(b.id);
              totalBudget += parseFloat(b.max_budget || b.min_budget || 0);
            }
          });
        }

        if (closedBidIds.size > 0) {
          const { data: closedBids } = await supabaseAdmin
            .from("bids")
            .select("id, min_budget, max_budget")
            .in("id", Array.from(closedBidIds))
            .eq("status", "closed");
          closedBids?.forEach(b => {
            if (!allBidIds.has(b.id)) {
              allBidIds.add(b.id);
              totalBudget += parseFloat(b.max_budget || b.min_budget || 0);
            }
          });
        }
      }

      return res.json({
        success: true,
        stats: {
          ...stats,
          totalBudget: totalBudget,
        },
      });
    } catch (error) {
      console.error("Error in getBidStats:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Initialize automated conversation for bid application
   */
  async initializeBidConversation(req, res) {
    try {
      const { bid_id, influencer_id, proposed_amount } = req.body;

      if (!bid_id || !influencer_id || !proposed_amount) {
        return res.status(400).json({
          success: false,
          message: "bid_id, influencer_id, and proposed_amount are required",
        });
      }

      // Verify user is the brand owner of this bid
      const { data: bid, error: bidError } = await supabaseAdmin
        .from("bids")
        .select("created_by")
        .eq("id", bid_id)
        .single();

      if (bidError || !bid) {
        return res.status(404).json({
          success: false,
          message: "Bid not found",
        });
      }

      if (bid.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Only the bid creator can initialize conversations",
        });
      }

      const result = await automatedFlowService.initializeBidConversation(
        bid_id,
        influencer_id,
        proposed_amount
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to initialize conversation",
          error: result.error,
        });
      }

      // Emit realtime events
      const io = req.app.get("io");
      if (io) {
        // Emit conversation_updated event
        io.to(`conversation_${result.conversation.id}`).emit("conversation_updated", {
          conversation_id: result.conversation.id,
          flow_state: result.conversation.flow_state,
          awaiting_role: result.conversation.awaiting_role,
          chat_status: result.conversation.chat_status
        });

        // Emit new_message events for each message created
        if (result.message) {
          io.to(`conversation_${result.conversation.id}`).emit("new_message", {
            conversation_id: result.conversation.id,
            message: result.message
          });
        }

        if (result.audit_message) {
          io.to(`conversation_${result.conversation.id}`).emit("new_message", {
            conversation_id: result.conversation.id,
            message: result.audit_message
          });
        }
      }

      res.json({
        success: true,
        message: "Automated conversation initialized successfully",
        conversation: result.conversation,
        request: result.request,
        flow_state: result.conversation.flow_state,
        awaiting_role: result.conversation.awaiting_role,
      });
    } catch (error) {
      console.error("Error initializing bid conversation:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle brand owner actions in automated bid flow
   */
  async handleBrandOwnerAction(req, res) {
    try {
      const { conversation_id, action, data, button_id, additional_data } = req.body;
      console.log("🧾 [BID] brand-owner-action body:", { conversation_id, action, data, button_id, additional_data });
      const userId = req.user.id;

      if (!conversation_id) {
        return res.status(400).json({
          success: false,
          message: "Missing conversation_id",
        });
      }

      // Handle button mapping only when an explicit button_id is provided
      let mappedAction = action;
      let mappedData = data || {};

      if (button_id) {
        const buttonToMap = button_id;

        if (buttonToMap === 'agree_negotiation') {
          mappedAction = 'handle_negotiation';
          mappedData = { action: 'agree' };
        } else if (buttonToMap === 'reject_negotiation') {
          mappedAction = 'handle_negotiation';
          mappedData = { action: 'reject' };
        } else if (buttonToMap === 'send_negotiated_price') {
          mappedAction = 'send_negotiated_price';
          mappedData = { price: additional_data?.price ?? mappedData?.price };
        } else if (buttonToMap === 'send_project_details') {
          mappedAction = 'send_project_details';
          mappedData = { details: additional_data?.details ?? mappedData?.details };
        } else if (buttonToMap === 'send_price_offer') {
          mappedAction = 'send_price_offer';
          mappedData = { price: additional_data?.price ?? mappedData?.price };
        } else if (buttonToMap === 'proceed_to_payment') {
          mappedAction = 'proceed_to_payment';
          mappedData = { ...(additional_data || {}), ...(mappedData || {}) };
        } else if (buttonToMap === 'accept_counter_offer') {
          mappedAction = 'accept_counter_offer';
          mappedData = { ...(additional_data || {}), ...(mappedData || {}) };
        } else if (buttonToMap === 'reject_counter_offer') {
          mappedAction = 'reject_counter_offer';
          mappedData = { price: additional_data?.price ?? mappedData?.price };
        } else if (buttonToMap === 'make_final_offer') {
          mappedAction = 'make_final_offer';
          mappedData = { ...(additional_data || {}), ...(mappedData || {}) };
        } else {
          // Fallback: merge, do not drop existing data
          mappedData = { ...(mappedData || {}), ...(additional_data || {}) };
        }
      }

      console.log("🧭 [BID] mapped action/data:", { mappedAction, mappedData });

      if (!mappedAction) {
        return res.status(400).json({
          success: false,
          message: "Missing action or button_id",
        });
      }

      // Verify user is part of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("brand_owner_id", userId)
        .single();

      if (convError || !conversation) {
        return res.status(403).json({
          success: false,
          message: "Access denied or conversation not found",
        });
      }

      // Handle the action using automated flow service
      const result = await automatedFlowService.handleBrandOwnerAction(
        conversation_id,
        mappedAction,
        mappedData
      );

      // Emit realtime events if action was successful
      if (result.success) {
        const io = req.app.get("io");
        if (io) {
          // Emit conversation_state_changed event (standardized)
          io.to(`conversation_${conversation_id}`).emit("conversation_state_changed", {
            conversation_id: conversation_id,
            previous_state: conversation.flow_state,
            new_state: result.conversation.flow_state,
            awaiting_role: result.conversation.awaiting_role,
            chat_status: result.conversation.chat_status,
            reason: mappedAction,
            timestamp: new Date().toISOString()
          });

          // Emit new_message events for each message created
          if (result.message) {
            io.to(`conversation_${conversation_id}`).emit("new_message", {
              conversation_id: conversation_id,
              message: result.message
            });
          }

          if (result.audit_message) {
            io.to(`conversation_${conversation_id}`).emit("new_message", {
              conversation_id: conversation_id,
              message: result.audit_message
            });
          }
        }
      }

      // ✅ Return the complete result structure for automated flow (matching CampaignController)
      res.json({
        success: true,
        conversation: result.conversation,
        message: result.message,
        audit_message: result.audit_message, // Include audit message for sender
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
      });
    } catch (error) {
      console.error("❌ Error handling brand owner action:", error);
      res.status(500).json({
        success: false,
        message: "Failed to handle action",
        error: error.message,
      });
    }
  }

  /**
   * Handle influencer actions in automated bid flow
   */
  async handleInfluencerAction(req, res) {
    try {
      const { conversation_id, action, data, button_id, additional_data } = req.body;
      const userId = req.user.id;

      if (!conversation_id) {
        return res.status(400).json({
          success: false,
          message: "Missing conversation_id",
        });
      }

      // Handle button mapping if button_id is provided OR if action is a button ID
      let mappedAction = action;
      let mappedData = data || {};

      // Check if we have button_id OR if action looks like a button ID
      const buttonToMap = button_id || action;

      if (buttonToMap) {

        // Map button IDs to automated flow actions (same logic as message controller)
        if (buttonToMap === 'accept_connection') {
          mappedAction = 'accept_connection';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'reject_connection') {
          mappedAction = 'reject_connection';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'accept_project') {
          mappedAction = 'accept_project';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'deny_project') {
          mappedAction = 'deny_project';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'accept_price') {
          mappedAction = 'accept_price';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'reject_price') {
          mappedAction = 'reject_price';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'negotiate_price') {
          mappedAction = 'negotiate_price';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'send_counter_offer') {
          mappedAction = 'send_counter_offer';
          mappedData = { price: additional_data?.price };
        } else if (buttonToMap === 'accept_final_offer') {
          mappedAction = 'accept_final_offer';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'reject_final_offer') {
          mappedAction = 'reject_final_offer';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'accept_negotiated_price') {
          mappedAction = 'accept_negotiated_price';
          mappedData = additional_data || {};
        } else if (buttonToMap === 'reject_negotiated_price') {
          mappedAction = 'reject_negotiated_price';
          mappedData = additional_data || {};

          // Use additional_data for unmapped buttons
          mappedData = additional_data || {};
        }

      }

      if (!mappedAction) {
        return res.status(400).json({
          success: false,
          message: "Missing action or button_id",
        });
      }

      // Verify user is part of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("influencer_id", userId)
        .single();

      if (convError || !conversation) {
        return res.status(403).json({
          success: false,
          message: "Access denied or conversation not found",
        });
      }

      // Handle the action using automated flow service
      const result = await automatedFlowService.handleInfluencerAction(
        conversation_id,
        mappedAction,
        mappedData
      );

      // Emit realtime events if action was successful
      if (result.success) {
        const io = req.app.get("io");
        if (io) {
          // Emit conversation_state_changed event (standardized)
          io.to(`conversation_${conversation_id}`).emit("conversation_state_changed", {
            conversation_id: conversation_id,
            previous_state: conversation.flow_state,
            new_state: result.conversation.flow_state,
            awaiting_role: result.conversation.awaiting_role,
            chat_status: result.conversation.chat_status,
            reason: mappedAction,
            timestamp: new Date().toISOString()
          });

          // Emit new_message events for each message created
          if (result.message) {
            io.to(`conversation_${conversation_id}`).emit("new_message", {
              conversation_id: conversation_id,
              message: result.message
            });
          }

          if (result.audit_message) {
            io.to(`conversation_${conversation_id}`).emit("new_message", {
              conversation_id: conversation_id,
              message: result.audit_message
            });
          }
        }
      }

      // ✅ Return the complete result structure for automated flow (matching CampaignController)
      res.json({
        success: true,
        conversation: result.conversation,
        message: result.message,
        audit_message: result.audit_message, // Include audit message for sender
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
      });
    } catch (error) {
      console.error("❌ Error handling influencer action:", error);
      res.status(500).json({
        success: false,
        message: "Failed to handle action",
        error: error.message,
      });
    }
  }

  /**
   * Handle final confirmation and payment initiation
   */
  async handleFinalConfirmation(req, res) {
    try {
      const { conversation_id } = req.body;
      const userId = req.user.id;

      if (!conversation_id) {
        return res.status(400).json({
          success: false,
          message: "Missing conversation ID",
        });
      }

      // Verify user is brand owner in this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("brand_owner_id", userId)
        .single();

      if (convError || !conversation) {
        return res.status(403).json({
          success: false,
          message: "Access denied or conversation not found",
        });
      }

      // Create payment order
      const orderData = {
        conversation_id: conversation_id,
        amount: conversation.flow_data?.agreed_amount || 0,
        currency: "INR",
        status: "pending",
        payment_type: "bid_collaboration",
      };

      const { data: order, error: orderError } = await supabaseAdmin
        .from("payment_orders")
        .insert(orderData)
        .select()
        .single();

      if (orderError) {
        throw new Error(
          `Failed to create payment order: ${orderError.message}`
        );
      }

      // Update conversation to payment pending
      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "payment_pending",
          awaiting_role: null,
        })
        .eq("id", conversation_id);

      if (updateError) {
        throw new Error(
          `Failed to update conversation: ${updateError.message}`
        );
      }

      res.json({
        success: true,
        message: "Payment order created successfully",
        order: order,
        conversation: {
          id: conversation_id,
          flow_state: "payment_pending",
          awaiting_role: null,
        },
      });
    } catch (error) {
      console.error("❌ Error handling final confirmation:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create payment order",
        error: error.message,
      });
    }
  }

  /**
   * Verify automated flow payment and transition to real-time chat
   */
  async verifyAutomatedFlowPayment(req, res) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        conversation_id
      } = req.body;
      const userId = req.user.id;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !conversation_id) {
        return res.status(400).json({
          success: false,
          message: "Missing required payment verification parameters"
        });
      }

      // Verify user is part of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversation_id)
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`)
        .single();

      if (convError || !conversation) {
        return res.status(403).json({
          success: false,
          message: "Access denied or conversation not found"
        });
      }

      // Verify Razorpay signature
      const crypto = require('crypto');
      const text = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest('hex');

      if (razorpay_signature !== expectedSignature) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment signature"
        });
      }

      // Check for duplicate payment
      const { data: existingTransaction } = await supabaseAdmin
        .from("transactions")
        .select("id")
        .eq("razorpay_payment_id", razorpay_payment_id)
        .single();

      if (existingTransaction) {
        return res.status(400).json({
          success: false,
          message: "Payment already processed"
        });
      }

      // Fetch actual payment amount from Razorpay (amount is in paise)
      let paymentAmount = 1000; // Default amount in paise
      let request = null;

      try {
        const Razorpay = require("razorpay");
        const razorpay = new Razorpay({
          key_id: process.env.RAZORPAY_KEY_ID,
          key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        const razorpayOrder = await razorpay.orders.fetch(razorpay_order_id);
        // Razorpay returns amount in paise
        paymentAmount = razorpayOrder.amount;

        console.log(`✅ [DEBUG] Fetched payment amount from Razorpay: ${paymentAmount} paise (₹${paymentAmount / 100})`);
      } catch (razorpayError) {
        console.error("⚠️ [DEBUG] Failed to fetch Razorpay order, falling back to request amount:", razorpayError.message);
        // Fallback to request amount if Razorpay fetch fails
        if (conversation.request_id) {
          const { data: requestData } = await supabaseAdmin
            .from("requests")
            .select("id, final_agreed_amount, influencer_id, campaign_id, bid_id")
            .eq("id", conversation.request_id)
            .single();

          request = requestData;
          // final_agreed_amount is in rupees, convert to paise
          paymentAmount = Math.round((request?.final_agreed_amount || 1) * 100);
        }
      }

      // Get request details if not already fetched
      if (!request && conversation.request_id) {
        const { data: requestData } = await supabaseAdmin
          .from("requests")
          .select("id, final_agreed_amount, influencer_id, campaign_id, bid_id")
          .eq("id", conversation.request_id)
          .single();

        request = requestData;
      }

      // Get influencer's wallet
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from("wallets")
        .select("id, balance_paise, frozen_balance_paise, user_id")
        .eq("user_id", conversation.influencer_id)
        .single();

      if (walletError) {
        console.error("Wallet error:", walletError);
        return res.status(500).json({
          success: false,
          message: "Failed to get influencer wallet"
        });
      }

      // Escrow only at verify-time (no wallet credit here). Wallet credit happens on admin release.
      const enhancedBalanceService = require('../utils/enhancedBalanceService');
      // Ensure wallet exists
      await enhancedBalanceService.getWalletBalance(conversation.influencer_id);

      // Upsert payment order: update if order already exists
      const { data: existingOrder } = await supabaseAdmin
        .from("payment_orders")
        .select("id, status")
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      let paymentOrder;
      if (existingOrder) {
        const { data: updatedOrder, error: updateOrderError } = await supabaseAdmin
          .from("payment_orders")
          .update({
            conversation_id: conversation_id,
            amount_paise: paymentAmount,
            currency: "INR",
            status: "verified",
            razorpay_payment_id: razorpay_payment_id,
            razorpay_signature: razorpay_signature,
            metadata: {
              conversation_type: conversation.campaign_id ? "campaign" : "bid",
              brand_owner_id: conversation.brand_owner_id,
              influencer_id: conversation.influencer_id
            }
          })
          .eq("id", existingOrder.id)
          .select()
          .single();

        if (updateOrderError) {
          console.error("Payment order update error:", updateOrderError);
          return res.status(500).json({ success: false, message: "Failed to update payment order" });
        }
        paymentOrder = updatedOrder;
      } else {
        const { data: insertedOrder, error: insertOrderError } = await supabaseAdmin
          .from("payment_orders")
          .insert({
            conversation_id: conversation_id,
            amount_paise: paymentAmount,
            currency: "INR",
            status: "verified",
            razorpay_order_id: razorpay_order_id,
            razorpay_payment_id: razorpay_payment_id,
            razorpay_signature: razorpay_signature,
            metadata: {
              conversation_type: conversation.campaign_id ? "campaign" : "bid",
              brand_owner_id: conversation.brand_owner_id,
              influencer_id: conversation.influencer_id
            }
          })
          .select()
          .single();

        if (insertOrderError) {
          console.error("Payment order creation error:", insertOrderError);
          return res.status(500).json({ success: false, message: "Failed to create payment order" });
        }
        paymentOrder = insertedOrder;
      }

      // Create brand owner's debit transaction immediately (so it's visible right away)
      if (conversation.brand_owner_id) {
        try {
          const trackResult = await enhancedBalanceService.trackBrandOwnerPayment(
            conversation.brand_owner_id,
            paymentAmount,
            conversation_id,
            {
              razorpay_order_id: razorpay_order_id,
              razorpay_payment_id: razorpay_payment_id,
              bid_id: conversation.bid_id,
              receiver_id: conversation.influencer_id,
              notes: `Payment sent for conversation ${conversation_id}`
            }
          );

          if (trackResult.success) {
            console.log(`✅ [DEBUG] Brand owner transaction created: ${trackResult.transaction.id}`);
          } else {
            console.warn(`⚠️ [DEBUG] Failed to create brand owner transaction: ${trackResult.error}`);
          }
        } catch (trackError) {
          console.error("❌ [DEBUG] Error creating brand owner transaction:", trackError);
          // Don't fail the payment verification if transaction tracking fails
        }
      }

      // Create admin payment tracking and pending release transactions (advance/final)
      try {
        // Fetch commission settings (fallback to 10% if missing)
        const { data: commissionSettings } = await supabaseAdmin
          .from("commission_settings")
          .select("commission_percentage, is_active")
          .eq("is_active", true)
          .order("effective_from", { ascending: false })
          .limit(1)
          .single();

        if (!commissionSettings) {
          throw new Error("No active commission settings found. Admin must set commission.");
        }
        const commissionPercentage = commissionSettings.commission_percentage;
        const totalAmountPaise = paymentAmount; // already in paise
        const commissionAmountPaise = Math.round((totalAmountPaise * commissionPercentage) / 100);
        const netAmountPaise = totalAmountPaise - commissionAmountPaise;
        const advanceAmountPaise = Math.round(netAmountPaise * 0.30);
        const finalAmountPaise = netAmountPaise - advanceAmountPaise;

        // Insert admin payment tracking row
        const { data: adminPaymentRecord, error: adminTrackErr } = await supabaseAdmin
          .from("admin_payment_tracking")
          .insert({
            conversation_id: conversation_id,
            campaign_id: conversation.campaign_id,
            bid_id: conversation.bid_id,
            brand_owner_id: conversation.brand_owner_id,
            influencer_id: conversation.influencer_id,
            total_amount_paise: totalAmountPaise,
            commission_amount_paise: commissionAmountPaise,
            net_amount_paise: netAmountPaise,
            advance_amount_paise: advanceAmountPaise,
            final_amount_paise: finalAmountPaise,
            commission_percentage: commissionPercentage,
            advance_payment_status: 'admin_received',
            final_payment_status: 'pending'
          })
          .select()
          .single();

        if (!adminTrackErr && adminPaymentRecord) {
          // Create pending advance and final transactions for influencer wallet
          const { error: txErr } = await supabaseAdmin
            .from("transactions")
            .insert([
              {
                wallet_id: walletId,
                amount: advanceAmountPaise / 100,
                amount_paise: advanceAmountPaise,
                type: "credit",
                status: "pending",
                campaign_id: conversation.campaign_id || null,
                bid_id: conversation.bid_id || null,
                conversation_id: conversation_id,
                payment_stage: "advance",
                admin_payment_tracking_id: adminPaymentRecord.id,
                description: "Advance payment (30% after commission)"
              },
              {
                wallet_id: walletId,
                amount: finalAmountPaise / 100,
                amount_paise: finalAmountPaise,
                type: "credit",
                status: "pending",
                campaign_id: conversation.campaign_id || null,
                bid_id: conversation.bid_id || null,
                conversation_id: conversation_id,
                payment_stage: "final",
                admin_payment_tracking_id: adminPaymentRecord.id,
                description: "Final payment (70% after commission)"
              }
            ]);
          // Ignore txErr to avoid failing verification path
        }
      } catch (e) {
        // Swallow errors so verification flow isn't blocked
        console.warn("⚠️ Failed to create admin payment release tracking:", e.message);
      }

      // Create escrow hold record after payment order is created
      let escrowHold = null;
      if (request) {
        const { data: newEscrowHold, error: escrowError } = await supabaseAdmin
          .from('escrow_holds')
          .insert({
            conversation_id: conversation_id,
            payment_order_id: paymentOrder.id,
            amount_paise: paymentAmount,
            status: 'held',
            release_reason: 'Payment held in escrow until work completion',
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (escrowError) {
          console.error("Escrow hold creation error:", escrowError);
          // Continue anyway as the payment is processed
        } else {
          escrowHold = newEscrowHold;

          // Use enhanced balance service to freeze funds in escrow
          const freezeResult = await enhancedBalanceService.freezeFunds(
            conversation.influencer_id,
            paymentAmount,
            newEscrowHold.id,
            {
              conversation_id: conversation_id,
              payment_order_id: paymentOrder.id,
              notes: `Funds frozen in escrow for ${conversation.campaign_id ? 'campaign' : 'bid'} collaboration`,
              sender_id: conversation.brand_owner_id,
              receiver_id: conversation.influencer_id
            }
          );

          if (!freezeResult.success) {
            // Continue anyway as escrow hold is created
          }
        }
      }

      // Ensure wallet exists (create if needed)
      let walletId = wallet?.id;
      if (!walletId) {
        const { data: newWallet, error: createWalletError } = await supabaseAdmin
          .from("wallets")
          .insert({ user_id: conversation.influencer_id, balance: 0, balance_paise: 0, frozen_balance_paise: 0 })
          .select()
          .single();
        if (createWalletError) {
          return res.status(500).json({ success: false, message: "Failed to ensure wallet" });
        }
        walletId = newWallet.id;
      }

      // No available balance change here; funds are considered held and frozen via escrow

      // Credit transaction already created by enhancedBalanceService.addFunds()
      // Only create the escrow freeze transaction

      // Create escrow freeze transaction
      const freezeTransactionData = {
        wallet_id: walletId,
        user_id: conversation.influencer_id,
        amount: paymentAmount / 100,
        amount_paise: paymentAmount,
        type: "freeze",
        direction: "debit",
        status: "completed",
        stage: "escrow_hold",
        razorpay_order_id: razorpay_order_id,
        razorpay_payment_id: razorpay_payment_id,
        related_payment_order_id: paymentOrder.id,
        escrow_hold_id: escrowHold?.id,
        is_escrow_frozen: true,
        escrow_status: "active",
        notes: `Funds frozen in escrow for collaboration${escrowHold ? ` (Escrow ID: ${escrowHold.id})` : ''}`,
        balance_after_paise: paymentAmount,
        frozen_balance_after_paise: paymentAmount,
        // Track who initiated the freeze (brand owner) and who owns the wallet (influencer)
        sender_id: conversation.brand_owner_id,
        receiver_id: conversation.influencer_id
      };

      // Add source reference for freeze transaction
      if (request) {
        if (request.campaign_id) {
          freezeTransactionData.campaign_id = request.campaign_id;
        } else if (request.bid_id) {
          freezeTransactionData.bid_id = request.bid_id;
        }
        freezeTransactionData.request_id = request.id;
      } else if (conversation.campaign_id) {
        freezeTransactionData.campaign_id = conversation.campaign_id;
      } else if (conversation.bid_id) {
        freezeTransactionData.bid_id = conversation.bid_id;
      }

      const { data: freezeTransaction, error: freezeTransactionError } = await supabaseAdmin
        .from("transactions")
        .insert(freezeTransactionData)
        .select()
        .single();

      if (freezeTransactionError) {
        // Don't fail the flow, just log the error
      }

      // Update request status to "paid" if request exists
      if (request) {
        const { error: requestUpdateError } = await supabaseAdmin
          .from("requests")
          .update({
            status: "paid",
            payment_date: new Date().toISOString()
          })
          .eq("id", request.id);

        if (requestUpdateError) {
          // Don't fail the payment, just log the error
        }
      }

      // Update source status (campaign or bid) to "pending" (work in progress)
      if (conversation.campaign_id) {
        await supabaseAdmin
          .from("campaigns")
          .update({ status: "pending" })
          .eq("id", conversation.campaign_id);
      } else if (conversation.bid_id) {
        await supabaseAdmin
          .from("bids")
          .update({ status: "pending" })
          .eq("id", conversation.bid_id);
      }

      // Check if admin payment tracking exists - if yes, await admin to process advance payment
      const { data: adminPaymentRecord } = await supabaseAdmin
        .from("admin_payment_tracking")
        .select("*")
        .eq("conversation_id", conversation_id)
        .eq("advance_payment_status", "admin_received")
        .single();

      // Determine next state based on whether admin payment flow is active
      let nextFlowState, nextAwaitingRole;
      if (adminPaymentRecord) {
        // Admin payment flow: wait for admin to process advance payment
        nextFlowState = "admin_advance_payment_pending";
        nextAwaitingRole = "admin";
      } else {
        // Direct payment flow: proceed to work
        nextFlowState = "work_in_progress";
        nextAwaitingRole = "influencer";
      }

      // Update conversation state
      const { data: updatedConversation, error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: nextFlowState,
          awaiting_role: nextAwaitingRole,
          chat_status: "real_time",
          conversation_type: conversation.campaign_id ? "campaign" : "bid",
          escrow_hold_id: escrowHold?.id, // Store escrow hold ID for later reference
          flow_data: {
            agreed_amount: paymentAmount / 100,
            agreement_timestamp: new Date().toISOString(),
            payment_completed: true,
            payment_timestamp: new Date().toISOString(),
            admin_payment_tracking_id: adminPaymentRecord?.id || null
          },
          current_action_data: {}
        })
        .eq("id", conversation_id)
        .select()
        .single();

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to update conversation state"
        });
      }

      // Generate MOU document after payment completion
      try {
        const mouService = require('../services/mouService');
        const mouResult = await mouService.generateMOU(conversation_id);
        if (mouResult.success) {
          console.log(`✅ [MOU] MOU generated for conversation ${conversation_id} after payment verification`);
        } else {
          console.error(`❌ [MOU] Failed to generate MOU: ${mouResult.error}`);
        }
      } catch (mouError) {
        console.error("❌ [MOU] Error generating MOU:", mouError);
        // Don't fail the request if MOU generation fails
      }

      // Create appropriate message based on flow
      let messageText, messageType, actionRequired, actionData;

      if (adminPaymentRecord) {
        // Admin payment flow: create message with admin action buttons
        const advanceAmount = adminPaymentRecord.advance_amount_paise / 100;
        const finalAmount = adminPaymentRecord.final_amount_paise / 100;
        const totalAmount = adminPaymentRecord.total_amount_paise / 100;
        const commissionAmount = adminPaymentRecord.commission_amount_paise / 100;

        messageText = `💳 **Payment Received - Admin Processing Required**

💰 **Total Amount:** ₹${totalAmount}
💼 **Commission (${adminPaymentRecord.commission_percentage}%):** ₹${commissionAmount}
💵 **Net Amount:** ₹${adminPaymentRecord.net_amount_paise / 100}

📊 **Payment Breakdown:**
• **Advance Payment:** ₹${advanceAmount} (30%)
• **Final Payment:** ₹${finalAmount} (70%)

⏳ **Status:** Waiting for admin to process advance payment...`;

        messageType = "automated";
        actionRequired = true;
        actionData = {
          title: "💳 **Admin Payment Processing Required**",
          subtitle: "Please process the advance payment to continue:",
          payment_breakdown: {
            total_amount: totalAmount,
            commission_amount: commissionAmount,
            net_amount: adminPaymentRecord.net_amount_paise / 100,
            advance_amount: advanceAmount,
            final_amount: finalAmount,
            commission_percentage: adminPaymentRecord.commission_percentage
          },
          admin_payment_tracking_id: adminPaymentRecord.id,
          buttons: [
            {
              id: "process_advance_payment",
              text: "Process Advance Payment",
              action: "process_advance_payment",
              style: "primary",
              visible_to: ["admin"]
            }
          ]
        };
      } else {
        // Direct payment flow: standard success message
        messageText = "🎉 **Payment Completed Successfully!**\n\nYour payment has been processed and the collaboration is now active. You can now communicate in real-time.";
        messageType = "automated";
        actionRequired = false;
        actionData = null;
      }

      const { data: successMessage, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation_id,
          sender_id: SYSTEM_USER_ID,
          receiver_id: null, // Visible to all participants
          message: messageText,
          message_type: messageType,
          action_required: actionRequired,
          action_data: actionData
        })
        .select()
        .single();

      // Always send advance payment notification message to influencer after payment verification
      const advancePaymentMessage = {
        conversation_id: conversation_id,
        sender_id: SYSTEM_USER_ID,
        receiver_id: conversation.influencer_id,
        message: `💰 **Advance Payment Update**\n\nYour advance payment (30% of net amount) will be sent by the admin soon. You will be notified once the payment is processed.`,
        message_type: "automated",
        action_required: false,
      };

      const { data: advanceMsg, error: advanceMsgError } = await supabaseAdmin
        .from("messages")
        .insert(advancePaymentMessage)
        .select()
        .single();

      if (advanceMsgError) {
        console.error("❌ Failed to send advance payment notification:", advanceMsgError);
      } else {
        console.log(`✅ [PAYMENT VERIFICATION] Advance payment notification sent to influencer: ${conversation.influencer_id}`);

        // Emit socket event for the advance payment message
        if (io && advanceMsg) {
          io.to(`room:${conversation_id}`).emit('chat:new', {
            message: advanceMsg
          });
        }
      }

      // Emit realtime events (final contract)
      const io = req.app.get("io");

      // Emit stats updates after status change
      if (io && conversation.brand_owner_id && conversation.influencer_id) {
        const { emitStatsUpdatesToBothUsers } = require('../utils/statsUpdates');
        await emitStatsUpdatesToBothUsers(conversation.brand_owner_id, conversation.influencer_id, io);
      }
      if (io) {
        // State change to room:<conversationId>
        io.to(`room:${conversation_id}`).emit('conversation_state_changed', {
          conversation_id: conversation_id,
          flow_state: 'work_in_progress',
          awaiting_role: updatedConversation.awaiting_role,
          chat_status: 'real_time',
          current_action_data: {},
          updated_at: new Date().toISOString()
        });

        // Optional system message
        if (successMessage) {
          io.to(`room:${conversation_id}`).emit('chat:new', { message: successMessage });
        }

        // Send individual notifications to both users
        io.to(`user_${conversation.brand_owner_id}`).emit("notification", {
          type: "payment_completed",
          data: {
            conversation_id: conversation_id,
            message: "Payment completed successfully",
            flow_state: "work_in_progress",
            chat_status: "real_time"
          }
        });

        io.to(`user_${conversation.influencer_id}`).emit("notification", {
          type: "payment_completed",
          data: {
            conversation_id: conversation_id,
            message: "Payment completed successfully",
            flow_state: "work_in_progress",
            chat_status: "real_time"
          }
        });

        // Conversation list updates for both users
        io.to(`user_${conversation.brand_owner_id}`).emit('conversation_list_updated', {
          conversation_id: conversation_id,
          action: 'state_changed',
          flow_state: 'work_in_progress',
          chat_status: 'real_time',
          timestamp: new Date().toISOString()
        });
        io.to(`user_${conversation.influencer_id}`).emit('conversation_list_updated', {
          conversation_id: conversation_id,
          action: 'state_changed',
          flow_state: 'work_in_progress',
          chat_status: 'real_time',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: "Payment verified and processed successfully",
        conversation: {
          id: updatedConversation.id,
          conversation_type: updatedConversation.conversation_type,
          flow_state: updatedConversation.flow_state,
          awaiting_role: updatedConversation.awaiting_role,
          chat_status: updatedConversation.chat_status,
          flow_data: updatedConversation.flow_data,
          current_action_data: updatedConversation.current_action_data,
          created_at: updatedConversation.created_at,
          updated_at: updatedConversation.updated_at
        },
        payment_status: {
          status: "verified",
          razorpay_payment_id: razorpay_payment_id,
          razorpay_order_id: razorpay_order_id,
          amount: paymentAmount,
          currency: "INR"
        }
      });

    } catch (error) {
      console.error("❌ Error verifying automated flow payment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to verify payment",
        error: error.message
      });
    }
  }

  /**
   * Get conversation flow context
   */
  async getConversationFlowContext(req, res) {
    try {
      const { conversation_id } = req.params;
      const userId = req.user.id;

      if (!conversation_id) {
        return res.status(400).json({
          success: false,
          message: "Missing conversation ID",
        });
      }

      // Verify user is part of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversation_id)
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`)
        .single();

      if (convError || !conversation) {
        return res.status(403).json({
          success: false,
          message: "Access denied or conversation not found",
        });
      }

      // Get flow context from automated flow service
      const result = await automatedFlowService.getConversationFlowContext(
        conversation_id
      );

      res.json(result);
    } catch (error) {
      console.error("❌ Error getting conversation flow context:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get flow context",
        error: error.message,
      });
    }
  }

  /**
   * Handle work submission for bid
   */
  async handleWorkSubmission(req, res) {
    try {
      const { conversation_id } = req.params;
      const { deliverables, description, submission_notes, attachments } = req.body;

      if (!deliverables && !description) {
        return res.status(400).json({
          success: false,
          message: "Either deliverables or description is required",
        });
      }

      // Verify user is the influencer of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("influencer_id, flow_state")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      if (conversation.influencer_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Only the influencer can submit work",
        });
      }

      if (conversation.flow_state !== "work_in_progress") {
        return res.status(400).json({
          success: false,
          message: "Work cannot be submitted at this stage",
        });
      }

      // Validate attachments if provided (should be array of attachment IDs)
      if (attachments && !Array.isArray(attachments)) {
        return res.status(400).json({
          success: false,
          message: "Attachments must be an array of attachment IDs",
        });
      }

      const submissionData = {
        deliverables: deliverables || "",
        description: description || "",
        submission_notes: submission_notes || "",
        attachments: attachments || [],
        submitted_at: new Date().toISOString(),
      };

      const result = await automatedFlowService.handleWorkSubmission(
        conversation_id,
        submissionData
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to submit work",
          error: result.error,
        });
      }

      // Emit realtime events (handleWorkSubmission already emits, but ensure consistency)
      const io = req.app.get("io");
      if (io && result.message) {
        // Emit standardized socket events
        io.to(`room:${conversation_id}`).emit('conversation_state_changed', {
          conversation_id: conversation_id,
          flow_state: result.flow_state,
          awaiting_role: result.awaiting_role,
          chat_status: 'automated',
          updated_at: new Date().toISOString()
        });

        io.to(`room:${conversation_id}`).emit('chat:new', {
          message: result.message
        });
      }

      res.json({
        success: true,
        message: "Work submitted successfully",
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
        message_data: result.message
      });
    } catch (error) {
      console.error("Error handling work submission:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle work review for bid
   */
  async handleWorkReview(req, res) {
    try {
      const { conversation_id } = req.params;
      const { action, feedback } = req.body;

      if (!action) {
        return res.status(400).json({
          success: false,
          message: "action is required",
        });
      }

      // Verify user is the brand owner of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("brand_owner_id, flow_state")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      if (conversation.brand_owner_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Only the brand owner can review work",
        });
      }

      if (conversation.flow_state !== "work_submitted") {
        return res.status(400).json({
          success: false,
          message: "Work cannot be reviewed at this stage",
        });
      }

      const result = await automatedFlowService.handleWorkReview(
        conversation_id,
        action,
        feedback
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to review work",
          error: result.error,
        });
      }

      // Note: automatedFlowService.handleWorkReview already emits all necessary socket events
      // including conversation_state_changed, chat:new, conversations:upsert with correct chat_status
      // So we don't need to emit duplicate events here. Only emit payment status update if needed.

      const io = req.app.get("io");
      if (io && result.flow_state === "work_approved") {
        // Emit payment status update if work is approved
        io.to(`conversation_${conversation_id}`).emit("payment_status_update", {
          conversation_id: conversation_id,
          status: "released",
          message: "Payment has been released from escrow"
        });
      }

      res.json({
        success: true,
        message: "Work reviewed successfully",
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
      });
    } catch (error) {
      console.error("Error handling work review:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
}

// Validation middleware
const validateCreateBid = [
  body("title")
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters"),
  body("description")
    .optional()
    .isLength({ min: 0, max: 2000 })
    .withMessage("Description must be less than 2000 characters"),
  body("min_budget")
    .isFloat({ min: 0 })
    .withMessage("Min budget must be a positive number"),
  body("max_budget")
    .isFloat({ min: 0 })
    .withMessage("Max budget must be a positive number"),
  body("requirements")
    .optional()
    .isLength({ min: 0, max: 1000 })
    .withMessage("Requirements must be less than 1000 characters"),
  body("language")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Language must be less than 50 characters"),
  body("platform")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Platform must be less than 50 characters"),
  body("content_type")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Content type must be less than 50 characters"),
  body("category")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Category must be less than 50 characters"),
  body("expiry_date")
    .optional()
    .isISO8601()
    .withMessage("Expiry date must be a valid ISO date"),
  body("image_url")
    .optional()
    .isURL()
    .withMessage("Image URL must be a valid URL"),
  // Custom validation to ensure max_budget >= min_budget
  body().custom((value) => {
    if (parseFloat(value.max_budget) < parseFloat(value.min_budget)) {
      throw new Error("Max budget must be greater than or equal to min budget");
    }
    return true;
  }),
];

const validateUpdateBid = [
  body("title")
    .optional()
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters"),
  body("description")
    .optional()
    .isLength({ min: 0, max: 2000 })
    .withMessage("Description must be less than 2000 characters"),
  body("min_budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Min budget must be a positive number"),
  body("max_budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Max budget must be a positive number"),
  body("requirements")
    .optional()
    .isLength({ min: 0, max: 1000 })
    .withMessage("Requirements must be less than 1000 characters"),
  body("language")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Language must be less than 50 characters"),
  body("platform")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Platform must be less than 50 characters"),
  body("content_type")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Content type must be less than 50 characters"),
  body("category")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Category must be less than 50 characters"),
  body("expiry_date")
    .optional()
    .isISO8601()
    .withMessage("Expiry date must be a valid ISO date"),
  body("image_url")
    .optional()
    .isURL()
    .withMessage("Image URL must be a valid URL"),
  // Custom validation to ensure max_budget >= min_budget
  body().custom((value) => {
    if (
      value.min_budget &&
      value.max_budget &&
      parseFloat(value.max_budget) < parseFloat(value.min_budget)
    ) {
      throw new Error("Max budget must be greater than or equal to min budget");
    }
    return true;
  }),
];

module.exports = {
  BidController: new BidController(),
  validateCreateBid,
  validateUpdateBid,
};
