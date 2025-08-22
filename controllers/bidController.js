const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult, query } = require("express-validator");
const {
  uploadImageToStorage,
  deleteImageFromStorage,
} = require("../utils/imageUpload");
const automatedFlowService = require("../utils/automatedFlowService");

class BidController {
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
        language,
        platform,
        content_type,
        category,
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

      const bidData = {
        title,
        description: description || "",
        min_budget: parseFloat(min_budget),
        max_budget: parseFloat(max_budget),
        requirements: requirements || null,
        language: language || null,
        platform: platform || null,
        content_type: content_type || null,
        category: category || null,
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
      } = req.query;

      const offset = (page - 1) * limit;
      let baseSelect = supabaseAdmin.from("bids").select(`
                    *,
                    created_by_user:users!bids_created_by_fkey (
                        id,
                        phone,
                        email,
                        role
                    ),
                    requests_count:requests(count)
                `);

      // Generic filters
      if (min_budget) {
        baseSelect = baseSelect.gte("min_budget", parseFloat(min_budget));
      }
      if (max_budget) {
        baseSelect = baseSelect.lte("max_budget", parseFloat(max_budget));
      }
      if (search) {
        baseSelect = baseSelect.or(
          `title.ilike.%${search}%,description.ilike.%${search}%`
        );
      }

      // Role-based server-driven filtering
      if (req.user.role === "influencer") {
        const userId = req.user.id;
        const normalizedStatus = (status || "open").toLowerCase();

        // Fetch all bid_ids this influencer has interacted with
        const { data: influencerRequests } = await supabaseAdmin
          .from("requests")
          .select("bid_id, status")
          .eq("influencer_id", userId)
          .not("bid_id", "is", null);

        const interactedBidIds = (influencerRequests || [])
          .map((r) => r.bid_id)
          .filter(Boolean);

        if (normalizedStatus === "open" || normalizedStatus === "new") {
          // Open/new: show all open bids (including interacted)
          let query = baseSelect.eq("status", "open");
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

          return res.json({
            success: true,
            bids: bids || [],
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: count || (bids || []).length,
              pages: Math.ceil((count || (bids || []).length) / limit),
            },
          });
        } else if (
          normalizedStatus === "pending" ||
          normalizedStatus === "closed"
        ) {
          // Map request statuses to tabs
          const pendingRequestStatuses = [
            "connected",
            "negotiating",
            "paid",
            "finalized",
            "work_submitted",
            "work_approved",
          ];
          const closedRequestStatuses = ["completed", "cancelled"];
          const allowedReqStatuses =
            normalizedStatus === "pending"
              ? pendingRequestStatuses
              : closedRequestStatuses;

          // Collect bid ids that have a matching request status for this influencer
          const filteredIds = (influencerRequests || [])
            .filter((r) => r.bid_id && allowedReqStatuses.includes(r.status))
            .map((r) => r.bid_id);
          const idsSet = new Set(filteredIds);
          if (idsSet.size === 0) {
            return res.json({
              success: true,
              bids: [],
              pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: 0,
                pages: 0,
              },
            });
          }

          let query = baseSelect
            .eq("status", normalizedStatus)
            .in("id", Array.from(idsSet));
          const { data: bids, error } = await query
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

          if (error) {
            return res
              .status(500)
              .json({ success: false, message: "Failed to fetch bids" });
          }

          return res.json({
            success: true,
            bids: bids || [],
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: (bids || []).length,
              pages: Math.ceil((bids || []).length / limit),
            },
          });
        } else {
          // Default: treat as open
          let query = baseSelect.eq("status", "open");
          const { data: bids, error } = await query
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) {
            return res
              .status(500)
              .json({ success: false, message: "Failed to fetch bids" });
          }
          const interactedSet = new Set(interactedBidIds);
          const filtered = (bids || []).filter((b) => !interactedSet.has(b.id));
          return res.json({
            success: true,
            bids: filtered,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: filtered.length,
              pages: Math.ceil(filtered.length / limit),
            },
          });
        }
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
        return res.json({
          success: true,
          bids: bids,
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
        return res.json({
          success: true,
          bids: bids,
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

      let query = supabaseAdmin
        .from("bids")
        .select(
          `
                    *,
                    created_by_user:users!bids_created_by_fkey (
                        id,
                        phone,
                        email,
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
                            phone,
                            email,
                            name,
                            role,
                            languages,
                            categories,
                            min_range,
                            max_range
                        )
                    )
                `
        )
        .eq("id", id);

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
        language,
        platform,
        content_type,
        category,
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
      if (language !== undefined) updateData.language = language;
      if (platform !== undefined) updateData.platform = platform;
      if (content_type !== undefined) updateData.content_type = content_type;
      if (category !== undefined) updateData.category = category;
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
        .select("created_by, image_url")
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

      // Delete associated image if it exists
      if (existingBid.image_url) {
        await deleteImageFromStorage(existingBid.image_url);
      }

      const { error } = await supabaseAdmin.from("bids").delete().eq("id", id);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to delete bid",
        });
      }

      res.json({
        success: true,
        message: "Bid deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get bid statistics
   */
  async getBidStats(req, res) {
    try {
      const userId = req.user.id;

      let query = supabaseAdmin
        .from("bids")
        .select("status, min_budget, max_budget");

      // Apply role-based filtering
      if (req.user.role === "brand_owner") {
        query = query.eq("created_by", userId);
      } else if (req.user.role === "influencer") {
        // Get bids where influencer has requests
        query = supabaseAdmin
          .from("requests")
          .select(
            `
                        bids (
                            status,
                            min_budget,
                            max_budget
                        )
                    `
          )
          .eq("influencer_id", userId);
      }

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch statistics",
        });
      }

      // Calculate statistics
      const bids =
        req.user.role === "influencer"
          ? data.map((item) => item.bids).filter(Boolean)
          : data;

      const stats = {
        total: bids.length,
        byStatus: {},
        totalBudget: 0,
      };

      bids.forEach((bid) => {
        // Status stats
        stats.byStatus[bid.status] = (stats.byStatus[bid.status] || 0) + 1;

        // Budget (use max_budget for total calculation)
        const bidBudget = parseFloat(bid.max_budget || bid.min_budget || 0);
        stats.totalBudget += bidBudget;
      });

      res.json({
        success: true,
        stats: stats,
      });
    } catch (error) {
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

      res.json({
        success: true,
        message: "Automated conversation initialized successfully",
        conversation: result.conversation,
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
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
   * Handle automated flow action from brand owner
   */
  async handleBrandOwnerAction(req, res) {
    try {
      const { conversation_id, action, data } = req.body;

      if (!conversation_id || !action) {
        return res.status(400).json({
          success: false,
          message: "conversation_id and action are required",
        });
      }

      // Verify user is the brand owner of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("brand_owner_id, flow_state, awaiting_role")
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
          message: "Only the brand owner can perform this action",
        });
      }

      if (conversation.awaiting_role !== "brand_owner") {
        return res.status(400).json({
          success: false,
          message: "Not your turn to respond",
        });
      }

      const result = await automatedFlowService.handleBrandOwnerResponse(
        conversation_id,
        action,
        data
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to handle action",
          error: result.error,
        });
      }

      res.json({
        success: true,
        message: "Action handled successfully",
        conversation: result.conversation,
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
      });
    } catch (error) {
      console.error("Error handling brand owner action:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle automated flow action from influencer
   */
  async handleInfluencerAction(req, res) {
    try {
      const { conversation_id, action, data } = req.body;

      if (!conversation_id || !action) {
        return res.status(400).json({
          success: false,
          message: "conversation_id and action are required",
        });
      }

      // Verify user is the influencer of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("influencer_id, flow_state, awaiting_role")
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
          message: "Only the influencer can perform this action",
        });
      }

      if (conversation.awaiting_role !== "influencer") {
        return res.status(400).json({
          success: false,
          message: "Not your turn to respond",
        });
      }

      const result = await automatedFlowService.handleInfluencerResponse(
        conversation_id,
        action,
        data
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to handle action",
          error: result.error,
        });
      }

      res.json({
        success: true,
        message: "Action handled successfully",
        conversation: result.conversation,
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
      });
    } catch (error) {
      console.error("Error handling influencer action:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle final confirmation for payment
   */
  async handleFinalConfirmation(req, res) {
    try {
      const { conversation_id, action } = req.body;

      if (!conversation_id || !action) {
        return res.status(400).json({
          success: false,
          message: "conversation_id and action are required",
        });
      }

      // Verify user is the brand owner of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("brand_owner_id, flow_state, awaiting_role")
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
          message: "Only the brand owner can perform this action",
        });
      }

      if (conversation.flow_state !== "brand_owner_confirming") {
        return res.status(400).json({
          success: false,
          message: "Invalid flow state for final confirmation",
        });
      }

      const result = await automatedFlowService.handleFinalConfirmation(
        conversation_id,
        action
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to handle final confirmation",
          error: result.error,
        });
      }

      res.json({
        success: true,
        message: "Final confirmation handled successfully",
        flow_state: result.flow_state,
      });
    } catch (error) {
      console.error("Error handling final confirmation:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get conversation flow context
   */
  async getConversationFlowContext(req, res) {
    try {
      const { conversation_id } = req.params;

      if (!conversation_id) {
        return res.status(400).json({
          success: false,
          message: "conversation_id is required",
        });
      }

      // Verify user is part of this conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("brand_owner_id, influencer_id")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      if (
        conversation.brand_owner_id !== req.user.id &&
        conversation.influencer_id !== req.user.id
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied to this conversation",
        });
      }

      const result = await automatedFlowService.getConversationFlowContext(
        conversation_id
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to get flow context",
          error: result.error,
        });
      }

      res.json({
        success: true,
        conversation: result.conversation,
        flow_context: result.flow_context,
      });
    } catch (error) {
      console.error("Error getting conversation flow context:", error);
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
