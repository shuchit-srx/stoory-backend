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

      // Emit realtime events
      const io = req.app.get("io");
      if (io) {
        // Emit conversation_updated event
        io.to(`conversation_${result.conversation.id}`).emit(
          "conversation_updated",
          {
            conversation_id: result.conversation.id,
            flow_state: result.conversation.flow_state,
            awaiting_role: result.conversation.awaiting_role,
            chat_status: result.conversation.chat_status,
          }
        );

        // Emit new_message events for each message created
        if (result.message) {
          io.to(`conversation_${result.conversation.id}`).emit("new_message", {
            conversation_id: result.conversation.id,
            message: result.message,
          });
        }

        if (result.audit_message) {
          io.to(`conversation_${result.conversation.id}`).emit("new_message", {
            conversation_id: result.conversation.id,
            message: result.audit_message,
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
      const { conversation_id, action, data } = req.body;
      const userId = req.user.id;

      if (!conversation_id || !action) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameters",
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
        action,
        data
      );

      // Emit realtime events if action was successful
      if (result.success) {
        const io = req.app.get("io");
        if (io) {
          // Emit conversation_updated event
          io.to(`conversation_${conversation_id}`).emit(
            "conversation_updated",
            {
              conversation_id: conversation_id,
              flow_state: result.conversation.flow_state,
              awaiting_role: result.conversation.awaiting_role,
              chat_status: result.conversation.chat_status,
            }
          );

          // Emit new_message events for each message created
          if (result.message) {
            io.to(`conversation_${conversation_id}`).emit("new_message", {
              conversation_id: conversation_id,
              message: result.message,
            });
          }

          if (result.audit_message) {
            io.to(`conversation_${conversation_id}`).emit("new_message", {
              conversation_id: conversation_id,
              message: result.audit_message,
            });
          }
        }
      }

      res.json(result);
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
      const { conversation_id, action, data } = req.body;
      const userId = req.user.id;

      if (!conversation_id || !action) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameters",
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
        action,
        data
      );

      // Emit realtime events if action was successful
      if (result.success) {
        const io = req.app.get("io");
        if (io) {
          // Emit conversation_updated event
          io.to(`conversation_${conversation_id}`).emit(
            "conversation_updated",
            {
              conversation_id: conversation_id,
              flow_state: result.conversation.flow_state,
              awaiting_role: result.conversation.awaiting_role,
              chat_status: result.conversation.chat_status,
            }
          );

          // Emit new_message events for each message created
          if (result.message) {
            io.to(`conversation_${conversation_id}`).emit("new_message", {
              conversation_id: conversation_id,
              message: result.message,
            });
          }

          if (result.audit_message) {
            io.to(`conversation_${conversation_id}`).emit("new_message", {
              conversation_id: conversation_id,
              message: result.audit_message,
            });
          }
        }
      }

      res.json(result);
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

      // Get or create wallet for the influencer
      let { data: wallet, error: walletError } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", conversation.influencer_id)
        .single();

      if (walletError && walletError.code === "PGRST116") {
        // Wallet doesn't exist, create one
        const { data: newWallet, error: createWalletError } =
          await supabaseAdmin
            .from("wallets")
            .insert({
              user_id: conversation.influencer_id,
              balance: 0.0,
            })
            .select()
            .single();

        if (createWalletError) {
          throw new Error(
            `Failed to create wallet: ${createWalletError.message}`
          );
        }
        wallet = newWallet;
      } else if (walletError) {
        throw new Error(`Failed to get wallet: ${walletError.message}`);
      }

      // Get or create brand owner wallet for debit transaction
      let { data: brandOwnerWallet, error: brandOwnerWalletError } =
        await supabaseAdmin
          .from("wallets")
          .select("*")
          .eq("user_id", conversation.brand_owner_id)
          .single();

      if (brandOwnerWalletError && brandOwnerWalletError.code === "PGRST116") {
        // Create brand owner wallet if it doesn't exist
        const {
          data: newBrandOwnerWallet,
          error: createBrandOwnerWalletError,
        } = await supabaseAdmin
          .from("wallets")
          .insert({
            user_id: conversation.brand_owner_id,
            balance: 0.0,
            balance_paise: 0,
            frozen_balance_paise: 0,
          })
          .select()
          .single();

        if (createBrandOwnerWalletError) {
          throw new Error(
            `Failed to create brand owner wallet: ${createBrandOwnerWalletError.message}`
          );
        }
        brandOwnerWallet = newBrandOwnerWallet;
      } else if (brandOwnerWalletError) {
        throw new Error(
          `Failed to get brand owner wallet: ${brandOwnerWalletError.message}`
        );
      }

      const agreedAmount = conversation.flow_data?.agreed_amount || 0;
      const sourceData = {};

      // Set the appropriate source ID
      if (conversation.bid_id) {
        sourceData.bid_id = conversation.bid_id;
      } else if (conversation.campaign_id) {
        sourceData.campaign_id = conversation.campaign_id;
      }

      // Get user names for better transaction tracking
      const { data: brandOwner, error: brandOwnerError } = await supabaseAdmin
        .from("users")
        .select("name, phone")
        .eq("id", conversation.brand_owner_id)
        .single();

      const { data: influencer, error: influencerError } = await supabaseAdmin
        .from("users")
        .select("name, phone")
        .eq("id", conversation.influencer_id)
        .single();

      const brandOwnerName =
        brandOwner?.name || `+${brandOwner?.phone?.slice(-4)}` || "Brand Owner";
      const influencerName =
        influencer?.name || `+${influencer?.phone?.slice(-4)}` || "Influencer";

      // Create CREDIT transaction for influencer
      const influencerTransactionData = {
        wallet_id: wallet.id,
        user_id: conversation.influencer_id,
        amount: agreedAmount,
        payment_amount: agreedAmount,
        type: "credit",
        status: "pending",
        notes: `Payment pending from ${brandOwnerName} for campaign collaboration`,
        sender_id: conversation.brand_owner_id,
        receiver_id: conversation.influencer_id,
        ...sourceData,
      };

      // Create DEBIT transaction for brand owner
      const brandOwnerTransactionData = {
        wallet_id: brandOwnerWallet.id,
        user_id: conversation.brand_owner_id,
        amount: agreedAmount,
        payment_amount: agreedAmount,
        type: "debit",
        status: "pending",
        notes: `Payment pending to ${influencerName} for campaign collaboration`,
        sender_id: conversation.brand_owner_id,
        receiver_id: conversation.influencer_id,
        ...sourceData,
      };

      // Insert both transactions
      const { data: influencerTransaction, error: influencerTransactionError } =
        await supabaseAdmin
          .from("transactions")
          .insert(influencerTransactionData)
          .select()
          .single();

      if (influencerTransactionError) {
        throw new Error(
          `Failed to create influencer transaction: ${influencerTransactionError.message}`
        );
      }

      const { data: brandOwnerTransaction, error: brandOwnerTransactionError } =
        await supabaseAdmin
          .from("transactions")
          .insert(brandOwnerTransactionData)
          .select()
          .single();

      if (brandOwnerTransactionError) {
        throw new Error(
          `Failed to create brand owner transaction: ${brandOwnerTransactionError.message}`
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
        message: "Dual transactions created successfully",
        transactions: {
          influencer: influencerTransaction,
          brand_owner: brandOwnerTransaction,
        },
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
        message: "Failed to create transaction",
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
        conversation_id,
      } = req.body;
      const userId = req.user.id;

      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature ||
        !conversation_id
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required payment verification parameters",
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

      // Verify Razorpay signature
      const crypto = require("crypto");
      const text = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest("hex");

      if (razorpay_signature !== expectedSignature) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment signature",
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
          message: "Payment already processed",
        });
      }

      // Get payment amount and request details
      let paymentAmount = 1000; // Default amount in paise
      let request = null;

      if (conversation.request_id) {
        const { data: requestData } = await supabaseAdmin
          .from("requests")
          .select("id, final_agreed_amount, influencer_id, campaign_id, bid_id")
          .eq("id", conversation.request_id)
          .single();

        request = requestData;
        paymentAmount = Math.round(
          (request?.final_agreed_amount || 1000) * 100
        ); // Convert to paise
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
          message: "Failed to get influencer wallet",
        });
      }

      // Update wallet balance (add payment amount in paise)
      const newBalance = (wallet.balance_paise || 0) + paymentAmount;
      const { error: walletUpdateError } = await supabaseAdmin
        .from("wallets")
        .update({
          balance_paise: newBalance,
          balance: newBalance / 100, // Keep old balance field for compatibility
        })
        .eq("id", wallet.id);

      if (walletUpdateError) {
        console.error("Wallet update error:", walletUpdateError);
        return res.status(500).json({
          success: false,
          message: "Failed to update wallet balance",
        });
      }

      // Upsert payment order: update if order already exists
      const { data: existingOrder } = await supabaseAdmin
        .from("payment_orders")
        .select("id, status")
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      let paymentOrder;
      if (existingOrder) {
        const { data: updatedOrder, error: updateOrderError } =
          await supabaseAdmin
            .from("payment_orders")
            .update({
              conversation_id: conversation_id,
              amount_paise: paymentAmount,
              currency: "INR",
              status: "verified",
              razorpay_payment_id: razorpay_payment_id,
              razorpay_signature: razorpay_signature,
              metadata: {
                conversation_type: conversation.campaign_id
                  ? "campaign"
                  : "bid",
                brand_owner_id: conversation.brand_owner_id,
                influencer_id: conversation.influencer_id,
              },
            })
            .eq("id", existingOrder.id)
            .select()
            .single();

        if (updateOrderError) {
          console.error("Payment order update error:", updateOrderError);
          return res.status(500).json({
            success: false,
            message: "Failed to update payment order",
          });
        }
        paymentOrder = updatedOrder;
      } else {
        const { data: insertedOrder, error: insertOrderError } =
          await supabaseAdmin
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
                conversation_type: conversation.campaign_id
                  ? "campaign"
                  : "bid",
                brand_owner_id: conversation.brand_owner_id,
                influencer_id: conversation.influencer_id,
              },
            })
            .select()
            .single();

        if (insertOrderError) {
          console.error("Payment order creation error:", insertOrderError);
          return res.status(500).json({
            success: false,
            message: "Failed to create payment order",
          });
        }
        paymentOrder = insertedOrder;
      }

      // Create escrow hold record after payment order is created
      let oldEscrowHold = null;
      if (request) {
        const { data: newEscrowHold, error: escrowError } = await supabaseAdmin
          .from("escrow_holds")
          .insert({
            conversation_id: conversation_id,
            payment_order_id: paymentOrder.id,
            amount_paise: paymentAmount,
            status: "held",
            release_reason: "Payment held in escrow until work completion",
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (escrowError) {
          console.error("Escrow hold creation error:", escrowError);
          // Continue anyway as the payment is processed
        } else {
          oldEscrowHold = newEscrowHold;
        }
      }

      // Ensure wallet exists (create if needed)
      let walletId = wallet?.id;
      if (!walletId) {
        const { data: newWallet, error: createWalletError } =
          await supabaseAdmin
            .from("wallets")
            .insert({
              user_id: conversation.influencer_id,
              balance: 0,
              balance_paise: 0,
              frozen_balance_paise: 0,
            })
            .select()
            .single();
        if (createWalletError) {
          console.error("Wallet create error:", createWalletError);
          return res
            .status(500)
            .json({ success: false, message: "Failed to ensure wallet" });
        }
        walletId = newWallet.id;
      }

      // Refresh wallet to get current balances, then add to frozen balance (escrow)
      const { data: curWallet, error: curWalletErr } = await supabaseAdmin
        .from("wallets")
        .select("id, balance, balance_paise, frozen_balance_paise")
        .eq("id", walletId)
        .single();
      if (curWalletErr) {
        console.error("Wallet read error:", curWalletErr);
      }

      // Use balance service for proper escrow management
      const balanceService = require("../utils/balanceService");

      // First add funds to influencer's wallet
      const addFundsResult = await balanceService.addFunds(
        conversation.influencer_id,
        paymentAmount,
        {
          razorpay_order_id: razorpay_order_id,
          razorpay_payment_id: razorpay_payment_id,
          related_payment_order_id: paymentOrder.id,
          notes: `Payment received from brand owner for collaboration`,
          sender_id: conversation.brand_owner_id,
          receiver_id: conversation.influencer_id,
          ...sourceData,
        }
      );

      if (!addFundsResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to add funds to influencer wallet",
          error: addFundsResult.error,
        });
      }

      // Create escrow hold
      const escrowResult = await balanceService.createEscrowHold(
        conversation_id,
        paymentOrder.id,
        paymentAmount,
        "Payment held in escrow until work completion"
      );

      if (!escrowResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to create escrow hold",
          error: escrowResult.error,
        });
      }

      // Freeze the funds in escrow
      const freezeResult = await balanceService.freezeFunds(
        conversation.influencer_id,
        paymentAmount,
        escrowResult.escrow_hold.id,
        {
          razorpay_order_id: razorpay_order_id,
          razorpay_payment_id: razorpay_payment_id,
          related_payment_order_id: paymentOrder.id,
          notes: `Funds frozen in escrow for collaboration`,
          sender_id: conversation.brand_owner_id,
          receiver_id: conversation.influencer_id,
          ...sourceData,
        }
      );

      if (!freezeResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to freeze funds in escrow",
          error: freezeResult.error,
        });
      }

      // Transactions are now handled by the balance service
      const escrowHoldData = escrowResult.escrow_hold;

      // Update request status to "paid" if request exists
      if (request) {
        const { error: requestUpdateError } = await supabaseAdmin
          .from("requests")
          .update({
            status: "paid",
            payment_date: new Date().toISOString(),
          })
          .eq("id", request.id);

        if (requestUpdateError) {
          console.error("Request update error:", requestUpdateError);
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

      // Update conversation to work_in_progress (enable chat) and store escrow hold ID
      const { data: updatedConversation, error: updateError } =
        await supabaseAdmin
          .from("conversations")
          .update({
            flow_state: "work_in_progress",
            awaiting_role: "influencer", // Influencer's turn to work
            chat_status: "real_time",
            conversation_type: conversation.campaign_id ? "campaign" : "bid",
            escrow_hold_id: escrowHoldData?.id, // Store escrow hold ID for later reference
            flow_data: {
              agreed_amount: paymentAmount / 100,
              agreement_timestamp: new Date().toISOString(),
              payment_completed: true,
              payment_timestamp: new Date().toISOString(),
            },
            current_action_data: {},
          })
          .eq("id", conversation_id)
          .select()
          .single();

      if (updateError) {
        console.error("Conversation update error:", updateError);
        return res.status(500).json({
          success: false,
          message: "Failed to update conversation state",
        });
      }

      // Create success message
      const { data: successMessage, error: messageError } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: conversation_id,
          sender_id: conversation.brand_owner_id,
          receiver_id: conversation.influencer_id,
          message:
            "🎉 **Payment Completed Successfully!**\n\nYour payment has been processed and the collaboration is now active. You can now communicate in real-time.",
          message_type: "system",
          action_required: false,
        })
        .select()
        .single();

      // Emit realtime events
      const io = req.app.get("io");
      if (io) {
        // Emit conversation_updated event
        io.to(`conversation_${conversation_id}`).emit("conversation_updated", {
          conversation_id: conversation_id,
          flow_state: "work_in_progress",
          awaiting_role: null,
          chat_status: "real_time",
        });

        // Emit new_message event
        if (successMessage) {
          io.to(`conversation_${conversation_id}`).emit("new_message", {
            conversation_id: conversation_id,
            message: successMessage,
          });
        }
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
          updated_at: updatedConversation.updated_at,
        },
        payment_status: {
          status: "verified",
          razorpay_payment_id: razorpay_payment_id,
          razorpay_order_id: razorpay_order_id,
          amount: paymentAmount,
          currency: "INR",
        },
        wallet_updates: {
          brand_owner: {
            balance_paise: 0, // Brand owner's balance would be updated separately
            frozen_balance_paise: 0,
          },
          influencer: {
            balance_paise: newBalance,
            frozen_balance_paise: paymentAmount,
          },
        },
      });
    } catch (error) {
      console.error("❌ Error verifying automated flow payment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to verify payment",
        error: error.message,
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
      const { deliverables, description, submission_notes } = req.body;

      if (!deliverables || !description) {
        return res.status(400).json({
          success: false,
          message: "deliverables and description are required",
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

      const submissionData = {
        deliverables,
        description,
        submission_notes,
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

      // Emit realtime events
      const io = req.app.get("io");
      if (io) {
        // Emit conversation_updated event
        io.to(`conversation_${conversation_id}`).emit("conversation_updated", {
          conversation_id: conversation_id,
          flow_state: result.flow_state,
          awaiting_role: result.awaiting_role,
          chat_status: "work_submitted",
        });

        // Emit new_message event
        if (result.message) {
          io.to(`conversation_${conversation_id}`).emit("new_message", {
            conversation_id: conversation_id,
            message: result.message,
          });
        }
      }

      res.json({
        success: true,
        message: "Work submitted successfully",
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
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

      // Emit realtime events
      const io = req.app.get("io");
      if (io) {
        // Emit conversation_updated event
        io.to(`conversation_${conversation_id}`).emit("conversation_updated", {
          conversation_id: conversation_id,
          flow_state: result.flow_state,
          awaiting_role: result.awaiting_role,
          chat_status:
            result.flow_state === "work_approved"
              ? "completed"
              : "work_in_progress",
        });

        // Emit new_message event
        if (result.message) {
          io.to(`conversation_${conversation_id}`).emit("new_message", {
            conversation_id: conversation_id,
            message: result.message,
          });
        }

        // Emit payment status update if work is approved
        if (result.flow_state === "work_approved") {
          io.to(`conversation_${conversation_id}`).emit(
            "payment_status_update",
            {
              conversation_id: conversation_id,
              status: "released",
              message: "Payment has been released from escrow",
            }
          );
        }
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
