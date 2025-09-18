const { supabaseAdmin } = require("../supabase/client");
const paymentService = require("../utils/payment");
const { body, validationResult } = require("express-validator");

class RequestController {
  /**
   * Apply to a campaign (create request)
   */
  async createRequest(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { campaign_id, bid_id } = req.body;

      // Ensure only influencers can apply
      if (req.user.role !== "influencer") {
        return res.status(403).json({
          success: false,
          message: "Only influencers can apply",
        });
      }

      // Validate that either campaign_id or bid_id is provided, not both
      if (!campaign_id && !bid_id) {
        return res.status(400).json({
          success: false,
          message: "Either campaign_id or bid_id is required",
        });
      }

      if (campaign_id && bid_id) {
        return res.status(400).json({
          success: false,
          message: "Cannot apply to both campaign and bid simultaneously",
        });
      }

      let source, sourceType, sourceId;

      if (campaign_id) {
        // Check if campaign exists and is open
        const { data: campaign, error: campaignError } = await supabaseAdmin
          .from("campaigns")
          .select("status, created_by")
          .eq("id", campaign_id)
          .single();

        if (campaignError || !campaign) {
          return res.status(404).json({
            success: false,
            message: "Campaign not found",
          });
        }

        if (campaign.status !== "open") {
          return res.status(400).json({
            success: false,
            message: "Campaign is not accepting applications",
          });
        }

        source = campaign;
        sourceType = "campaign";
        sourceId = campaign_id;
      } else {
        // Check if bid exists and is open
        const { data: bid, error: bidError } = await supabaseAdmin
          .from("bids")
          .select("status, created_by")
          .eq("id", bid_id)
          .single();

        if (bidError || !bid) {
          return res.status(404).json({
            success: false,
            message: "Bid not found",
          });
        }

        if (bid.status !== "open") {
          return res.status(400).json({
            success: false,
            message: "Bid is not accepting applications",
          });
        }

        source = bid;
        sourceType = "bid";
        sourceId = bid_id;
      }

      // Check if user has already applied
      const { data: existingRequest, error: existingError } =
        await supabaseAdmin
          .from("requests")
          .select("id")
          .eq(sourceType === "campaign" ? "campaign_id" : "bid_id", sourceId)
          .eq("influencer_id", userId)
          .single();

      if (existingRequest) {
        return res.status(400).json({
          success: false,
          message: `You have already applied to this ${sourceType}`,
        });
      }

      // Create request (connection initiated for organic discovery)
      const requestData = {
        influencer_id: userId,
        status: "connected",
      };

      if (sourceType === "campaign") {
        requestData.campaign_id = sourceId;
        // Store proposed amount for campaign applications if provided
        if (req.body.proposed_amount) {
          requestData.proposed_amount = req.body.proposed_amount;
        }
      } else {
        requestData.bid_id = sourceId;
        // Store proposed amount for bid applications
        if (req.body.proposed_amount) {
          requestData.proposed_amount = req.body.proposed_amount;
        }
      }

      // Store message if provided
      if (req.body.message) {
        requestData.message = req.body.message;
      }

      const { data: request, error } = await supabaseAdmin
        .from("requests")
        .insert(requestData)
        .select(
          `
                    *,
                    campaigns (
                        *,
                        type:campaign_type
                    ),
                    bids (*),
                    influencer:users!requests_influencer_id_fkey (*)
                `
        )
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to create request",
        });
      }

      // Emit real-time update to bid/campaign room
      const io = req.app.get("io");
      if (io) {
        if (sourceType === "campaign") {
          io.to(`campaign_${sourceId}`).emit("new_influencer_application", {
            type: "campaign",
            campaignId: sourceId,
            influencerId: userId,
            requestId: request.id,
            timestamp: new Date().toISOString(),
          });
        } else {
          io.to(`bid_${sourceId}`).emit("new_influencer_application", {
            type: "bid",
            bidId: sourceId,
            influencerId: userId,
            requestId: request.id,
            timestamp: new Date().toISOString(),
          });
        }
      }

      res.status(201).json({
        success: true,
        request: request,
        message: "Application submitted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get requests with filtering and pagination
   */
  async getRequests(req, res) {
    try {
      const { page = 1, limit = 10, status, campaign_id } = req.query;

      const offset = (page - 1) * limit;
      let query = supabaseAdmin.from("requests").select(`
                    *,
                    campaigns (
                        id,
                        title,
                        type:campaign_type,
                        budget,
                        status,
                        created_by_user:users!campaigns_created_by_fkey (
                            id,
                            phone,
                            email,
                            role
                        )
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        phone,
                        email,
                        role,
                        languages,
                        categories,
                        min_range,
                        max_range
                    )
                `);

      // Apply filters
      if (status) {
        query = query.eq("status", status);
      }
      if (campaign_id) {
        query = query.eq("campaign_id", campaign_id);
      }

      // Apply role-based filtering
      if (req.user.role === "influencer") {
        query = query.eq("influencer_id", req.user.id);
      } else if (req.user.role === "brand_owner") {
        // Get requests for campaigns created by this brand owner
        query = supabaseAdmin
          .from("requests")
          .select(
            `
                        *,
                        campaigns!inner (
                            id,
                            title,
                            type:campaign_type,
                            budget,
                            status,
                            created_by_user:users!campaigns_created_by_fkey (
                                id,
                                phone,
                                email,
                                role
                            )
                        ),
                        influencer:users!requests_influencer_id_fkey (
                            id,
                            phone,
                            email,
                            role,
                            languages,
                            categories,
                            min_range,
                            max_range
                        )
                    `
          )
          .eq("campaigns.created_by", req.user.id);
      }
      // Admin can see all requests

      const {
        data: requests,
        error,
        count,
      } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch requests",
        });
      }

      const normalizedRequests = (requests || []).map((r) => ({
        ...r,
        amount:
          r.final_agreed_amount !== null && r.final_agreed_amount !== undefined
            ? r.final_agreed_amount
            : r.proposed_amount !== undefined
            ? r.proposed_amount
            : null,
      }));

      res.json({
        success: true,
        requests: normalizedRequests,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get a specific request by ID
   */
  async getRequest(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { data: request, error } = await supabaseAdmin
        .from("requests")
        .select(
          `
                    *,
                    campaigns (
                        id,
                        title,
                        type:campaign_type,
                        budget,
                        status,
                        created_by,
                        created_by_user:users!campaigns_created_by_fkey (
                            id,
                            phone,
                            email,
                            role
                        )
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        phone,
                        email,
                        role,
                        languages,
                        categories,
                        min_range,
                        max_range
                    ),
                    conversations (
                        id,
                        messages (
                            id,
                            sender_id,
                            receiver_id,
                            message,
                            media_url,
                            seen,
                            created_at
                        )
                    )
                `
        )
        .eq("id", id)
        .single();

      if (error || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check access permissions
      if (req.user.role === "influencer" && request.influencer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (
        req.user.role === "brand_owner" &&
        request.campaigns.created_by !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      res.json({
        success: true,
        request: request,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Update request status (approve/reject)
   */
  async updateRequestStatus(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { status } = req.body;
      const userId = req.user.id;

      // Check if request exists
      const { data: request, error: fetchError } = await supabaseAdmin
        .from("requests")
        .select(
          `
                    *,
                    campaigns (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        wallets (id)
                    )
                `
        )
        .eq("id", id)
        .single();

      if (fetchError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check permissions
      if (
        req.user.role === "brand_owner" &&
        request.campaigns.created_by !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (req.user.role !== "brand_owner" && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can update request status",
        });
      }

      // Validate status transition
      const validTransitions = {
        pending: ["approved", "rejected"],
        approved: ["in_progress", "rejected"],
        in_progress: ["completed"],
        completed: [],
        rejected: [],
      };

      if (!validTransitions[request.status].includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot change status from ${request.status} to ${status}`,
        });
      }

      // Update request status
      const { data: updatedRequest, error } = await supabaseAdmin
        .from("requests")
        .update({ status: status })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to update request status",
        });
      }

      res.json({
        success: true,
        request: updatedRequest,
        message: "Request status updated successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Process approval payment
   */
  async processApprovalPayment(req, res) {
    try {
      const { request_id } = req.body;
      const userId = req.user.id;

      // Check if request exists and user has permission
      const { data: request, error: fetchError } = await supabaseAdmin
        .from("requests")
        .select(
          `
                    *,
                    campaigns (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        wallets (id)
                    )
                `
        )
        .eq("id", request_id)
        .single();

      if (fetchError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check permissions
      if (
        req.user.role === "brand_owner" &&
        request.campaigns.created_by !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (req.user.role !== "brand_owner" && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can process payments",
        });
      }

      if (request.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: "Request is not in pending status",
        });
      }

      // Calculate approval amount (50% of budget)
      const approvalAmount = parseFloat(request.campaigns.budget) * 0.5;

      // Process payment
      const paymentResult = await paymentService.processApprovalPayment(
        request_id,
        approvalAmount
      );

      if (!paymentResult.success) {
        return res.status(500).json({
          success: false,
          message: paymentResult.error,
        });
      }

      res.json({
        success: true,
        order: paymentResult.order,
        message: "Payment order created successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Process completion payment
   */
  async processCompletionPayment(req, res) {
    try {
      const { request_id } = req.body;
      const userId = req.user.id;

      // Check if request exists and user has permission
      const { data: request, error: fetchError } = await supabaseAdmin
        .from("requests")
        .select(
          `
                    *,
                    campaigns (
                        id,
                        title,
                        created_by,
                        budget
                    ),
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        wallets (id)
                    )
                `
        )
        .eq("id", request_id)
        .single();

      if (fetchError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check permissions
      if (
        req.user.role === "brand_owner" &&
        request.campaigns.created_by !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (req.user.role !== "brand_owner" && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can process payments",
        });
      }

      if (request.status !== "in_progress") {
        return res.status(400).json({
          success: false,
          message: "Request is not in progress",
        });
      }

      // Calculate completion amount (remaining 50% of budget)
      const completionAmount = parseFloat(request.campaigns.budget) * 0.5;

      // Process payment
      const paymentResult = await paymentService.processCompletionPayment(
        request_id,
        completionAmount
      );

      if (!paymentResult.success) {
        return res.status(500).json({
          success: false,
          message: paymentResult.error,
        });
      }

      res.json({
        success: true,
        order: paymentResult.order,
        message: "Completion payment order created successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Update final agreed amount (after chat negotiation)
   */
  async updateAgreedAmount(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { final_agreed_amount } = req.body;
      const userId = req.user.id;

      // Check if request exists and user has permission
      const { data: request, error: checkError } = await supabaseAdmin
        .from("requests")
        .select("influencer_id, campaign_id, bid_id")
        .eq("id", id)
        .single();

      if (checkError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Only influencer can update agreed amount
      if (request.influencer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      const { data: updatedRequest, error } = await supabaseAdmin
        .from("requests")
        .update({
          final_agreed_amount: final_agreed_amount,
          status: "negotiating",
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to update agreed amount",
        });
      }

      res.json({
        success: true,
        request: updatedRequest,
        message: "Agreed amount updated successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Withdraw application
   */
  async withdrawRequest(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Check if request exists
      const { data: request, error: fetchError } = await supabaseAdmin
        .from("requests")
        .select("influencer_id, status")
        .eq("id", id)
        .single();

      if (fetchError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check permissions
      if (request.influencer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (request.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: "Cannot withdraw approved or in-progress request",
        });
      }

      // Delete the request
      const { error } = await supabaseAdmin
        .from("requests")
        .delete()
        .eq("id", id);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to withdraw request",
        });
      }

      res.json({
        success: true,
        message: "Application withdrawn successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get influencers who applied to a specific bid
   */
  async getBidInfluencers(req, res) {
    try {
      const { bid_id } = req.params;
      const userId = req.user.id;

      // Check if bid exists and user has permission
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

      // Only bid creator or admin can view influencers
      if (bid.created_by !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Get influencers who applied to this bid
      const { data: influencers, error } = await supabaseAdmin
        .from("requests")
        .select(
          `
                    id,
                    status,
                    proposed_amount,
                    message,
                    final_agreed_amount,
                    payment_status,
                    payment_frozen_at,
                    payment_withdrawable_at,
                    created_at,
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        phone,
                        email,
                        name,
                        languages,
                        categories,
                        min_range,
                        max_range,
                        role
                    )
                `
        )
        .eq("bid_id", bid_id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Database error fetching bid influencers:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch influencers",
          error: error.message,
        });
      }

      console.log("Successfully fetched bid influencers:", {
        bidId: bid_id,
        count: influencers.length,
        influencers: influencers,
      });

      res.json({
        success: true,
        influencers: influencers,
        total: influencers.length,
      });
    } catch (error) {
      console.error("Error getting bid influencers:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  /**
   * Get influencers who applied to a specific campaign
   */
  async getCampaignInfluencers(req, res) {
    try {
      const { campaign_id } = req.params;
      const userId = req.user.id;

      // Check if campaign exists and user has permission
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("campaigns")
        .select("created_by")
        .eq("id", campaign_id)
        .single();

      if (campaignError || !campaign) {
        return res.status(404).json({
          success: false,
          message: "Campaign not found",
        });
      }

      // Only campaign creator or admin can view influencers
      if (campaign.created_by !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Get influencers who applied to this campaign
      const { data: influencers, error } = await supabaseAdmin
        .from("requests")
        .select(
          `
                    id,
                    status,
                    proposed_amount,
                    message,
                    final_agreed_amount,
                    payment_status,
                    payment_frozen_at,
                    payment_withdrawable_at,
                    created_at,
                    influencer:users!requests_influencer_id_fkey (
                        id,
                        phone,
                        email,
                        name,
                        languages,
                        categories,
                        min_range,
                        max_range,
                        role
                    )
                `
        )
        .eq("campaign_id", campaign_id)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch influencers",
        });
      }

      res.json({
        success: true,
        influencers: influencers,
        total: influencers.length,
      });
    } catch (error) {
      console.error("Error getting campaign influencers:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get real-time influencer count for a bid
   */
  async getBidInfluencerCount(req, res) {
    try {
      const { bid_id } = req.params;
      const userId = req.user.id;

      // Check if bid exists and user has permission
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

      // Only bid creator or admin can view count
      if (bid.created_by !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Get count of influencers who applied
      const { count, error } = await supabaseAdmin
        .from("requests")
        .select("*", { count: "exact", head: true })
        .eq("bid_id", bid_id);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch influencer count",
        });
      }

      res.json({
        success: true,
        count: count || 0,
      });
    } catch (error) {
      console.error("Error getting bid influencer count:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get real-time influencer count for a campaign
   */
  async getCampaignInfluencerCount(req, res) {
    try {
      const { campaign_id } = req.params;
      const userId = req.user.id;

      // Check if campaign exists and user has permission
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("campaigns")
        .select("created_by")
        .eq("id", campaign_id)
        .single();

      if (campaignError || !campaign) {
        return res.status(404).json({
          success: false,
          message: "Campaign not found",
        });
      }

      // Only campaign creator or admin can view count
      if (campaign.created_by !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Get count of influencers who applied
      const { count, error } = await supabaseAdmin
        .from("requests")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaign_id);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch influencer count",
        });
      }

      res.json({
        success: true,
        count: count || 0,
      });
    } catch (error) {
      console.error("Error getting campaign influencer count:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Finalize agreement between brand owner and influencer
   */
  async finalizeAgreement(req, res) {
    try {
      const { id } = req.params;
      const { final_amount, agreement_terms } = req.body;
      const userId = req.user.id;

      // Get request details
      const { data: request, error: requestError } = await supabaseAdmin
        .from("requests")
        .select(
          "id, brand_owner_id, influencer_id, status, campaign_id, bid_id"
        )
        .eq("id", id)
        .single();

      if (requestError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check if user is brand owner
      if (request.brand_owner_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Only brand owner can finalize agreement",
        });
      }

      // Check if request is in correct status
      if (request.status !== "connected" && request.status !== "negotiating") {
        return res.status(400).json({
          success: false,
          message: "Request must be connected or negotiating to finalize",
        });
      }

      // Validate final amount
      if (!final_amount || final_amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid final amount is required",
        });
      }

      // Update request with final agreement
      const { error: updateError } = await supabaseAdmin
        .from("requests")
        .update({
          final_agreed_amount: final_amount,
          status: "finalized",
          agreement_terms: agreement_terms || null,
          finalized_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to finalize agreement",
        });
      }

      // Do not auto-create conversations here; conversation is created later (e.g., after payment)

      res.json({
        success: true,
        message: "Agreement finalized successfully",
        data: {
          request_id: id,
          final_amount: final_amount,
          status: "finalized",
          payment_required: true,
        },
      });
    } catch (error) {
      console.error("Finalize agreement error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Submit work (influencer)
   */
  async submitWork(req, res) {
    try {
      const { id } = req.params;
      const {
        work_submission_link,
        work_description,
        work_files = [],
      } = req.body;
      const userId = req.user.id;

      // Check if request exists and user has permission
      const { data: request, error: checkError } = await supabaseAdmin
        .from("requests")
        .select("influencer_id, status, revoke_count, max_revokes")
        .eq("id", id)
        .single();

      if (checkError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Only influencer can submit work
      if (request.influencer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Validate status
      if (request.status !== "paid") {
        return res.status(400).json({
          success: false,
          message: "Payment must be completed before submitting work",
        });
      }

      // Validate work submission
      if (!work_submission_link && work_files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Either work submission link or files are required",
        });
      }

      const { data: updatedRequest, error } = await supabaseAdmin
        .from("requests")
        .update({
          work_submission_link: work_submission_link,
          work_description: work_description,
          work_files: work_files,
          work_submission_date: new Date().toISOString(),
          status: "work_submitted",
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to submit work",
        });
      }

      res.json({
        success: true,
        request: updatedRequest,
        message: "Work submitted successfully",
      });
    } catch (error) {
      console.error("Submit work error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Approve work (brand owner)
   */
  async approveWork(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Check if request exists
      const { data: request, error: checkError } = await supabaseAdmin
        .from("requests")
        .select(
          "campaign_id, bid_id, influencer_id, status, final_agreed_amount"
        )
        .eq("id", id)
        .single();

      if (checkError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Get brand owner ID from campaign/bid
      let brandOwnerId;
      if (request.campaign_id) {
        const { data: campaign } = await supabaseAdmin
          .from("campaigns")
          .select("created_by")
          .eq("id", request.campaign_id)
          .single();
        brandOwnerId = campaign?.created_by;
      } else {
        const { data: bid } = await supabaseAdmin
          .from("bids")
          .select("created_by")
          .eq("id", request.bid_id)
          .single();
        brandOwnerId = bid?.created_by;
      }

      // Only brand owner can approve work
      if (brandOwnerId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Validate status
      if (request.status !== "work_submitted") {
        return res.status(400).json({
          success: false,
          message: "Work must be submitted before approval",
        });
      }

      // Start transaction to update request and unfreeze money
      const { data: updatedRequest, error: updateError } = await supabaseAdmin
        .from("requests")
        .update({
          work_approval_date: new Date().toISOString(),
          status: "work_approved",
        })
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to approve work",
        });
      }

      // Unfreeze money in influencer's wallet
      const { error: walletError } = await supabaseAdmin.rpc(
        "unfreeze_payment",
        {
          request_uuid: id,
          influencer_uuid: request.influencer_id,
          amount: request.final_agreed_amount,
        }
      );

      if (walletError) {
        console.error("Wallet unfreeze error:", walletError);
        // Continue anyway as the work is approved
      }

      // Close conversation
      await supabaseAdmin
        .from("conversations")
        .update({
          chat_status: "closed",
        })
        .eq("request_id", id);

      res.json({
        success: true,
        request: updatedRequest,
        message: "Work approved. Money is now available for withdrawal.",
      });
    } catch (error) {
      console.error("Approve work error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Request revision (brand owner)
   */
  async requestRevision(req, res) {
    try {
      const { id } = req.params;
      const { revision_reason } = req.body;
      const userId = req.user.id;

      // Check if request exists
      const { data: request, error: checkError } = await supabaseAdmin
        .from("requests")
        .select(
          "campaign_id, bid_id, influencer_id, status, revoke_count, max_revokes"
        )
        .eq("id", id)
        .single();

      if (checkError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Get brand owner ID from campaign/bid
      let brandOwnerId;
      if (request.campaign_id) {
        const { data: campaign } = await supabaseAdmin
          .from("campaigns")
          .select("created_by")
          .eq("id", request.campaign_id)
          .single();
        brandOwnerId = campaign?.created_by;
      } else {
        const { data: bid } = await supabaseAdmin
          .from("bids")
          .select("created_by")
          .eq("id", request.bid_id)
          .single();
        brandOwnerId = bid?.created_by;
      }

      // Only brand owner can request revision
      if (brandOwnerId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Validate status
      if (request.status !== "work_submitted") {
        return res.status(400).json({
          success: false,
          message: "Work must be submitted before requesting revision",
        });
      }

      // Check revoke limit
      if (request.revoke_count >= request.max_revokes) {
        return res.status(400).json({
          success: false,
          message: `Maximum revisions (${request.max_revokes}) reached. Cannot request more revisions.`,
        });
      }

      const { data: updatedRequest, error } = await supabaseAdmin
        .from("requests")
        .update({
          revoke_count: request.revoke_count + 1,
          status: "paid", // Back to paid status for new work submission
          work_submission_link: null,
          work_submission_date: null,
          work_description: null,
          work_files: [],
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to request revision",
        });
      }

      res.json({
        success: true,
        request: updatedRequest,
        message: `Revision requested. ${
          request.max_revokes - (request.revoke_count + 1)
        } revisions remaining.`,
      });
    } catch (error) {
      console.error("Request revision error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get work status for a request
   */
  async getWorkStatus(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get request details
      const { data: request, error: requestError } = await supabaseAdmin
        .from("requests")
        .select(
          `
          id, 
          brand_owner_id, 
          influencer_id, 
          status, 
          final_agreed_amount,
          revoke_count, 
          max_revokes,
          work_submission_date,
          work_approval_date,
          work_description,
          work_submission_link,
          work_files
        `
        )
        .eq("id", id)
        .single();

      if (requestError || !request) {
        return res.status(404).json({
          success: false,
          message: "Request not found",
        });
      }

      // Check if user is part of the request
      if (
        request.brand_owner_id !== userId &&
        request.influencer_id !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Get conversation details
      const { data: conversation } = await supabaseAdmin
        .from("conversations")
        .select("id, chat_status, payment_completed")
        .eq("request_id", id)
        .single();

      const workStatus = {
        request_id: id,
        status: request.status,
        final_amount: request.final_agreed_amount,
        revoke_count: request.revoke_count,
        max_revokes: request.max_revokes,
        revokes_remaining: request.max_revokes - request.revoke_count,
        work_submitted: !!request.work_submission_date,
        work_approved: !!request.work_approval_date,
        work_submission_date: request.work_submission_date,
        work_approval_date: request.work_approval_date,
        work_description: request.work_description,
        work_submission_link: request.work_submission_link,
        work_files: request.work_files || [],
        chat_status: conversation?.chat_status || "real_time", // FIXED: Use 'real_time' to match database constraint
        payment_completed: conversation?.payment_completed || false,
      };

      res.json({
        success: true,
        message: "Work status retrieved successfully",
        data: workStatus,
      });
    } catch (error) {
      console.error("Get work status error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Validate budget constraints
   */
  validateBudgetConstraints(request, finalAmount) {
    if (request.campaign_id) {
      // Campaign-based validation
      const campaign = request.campaign;
      if (campaign.min_budget && finalAmount < campaign.min_budget) {
        return {
          valid: false,
          message: `Amount must be at least ₹${campaign.min_budget}`,
        };
      }
      if (campaign.max_budget && finalAmount > campaign.max_budget) {
        return {
          valid: false,
          message: `Amount cannot exceed ₹${campaign.max_budget}`,
        };
      }
    } else if (request.bid_id) {
      // Bid-based validation
      const bid = request.bid;
      if (bid.min_budget && finalAmount < bid.min_budget) {
        return {
          valid: false,
          message: `Amount must be at least ₹${bid.min_budget}`,
        };
      }
      if (bid.max_budget && finalAmount > bid.max_budget) {
        return {
          valid: false,
          message: `Amount cannot exceed ₹${bid.max_budget}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Check if user is brand owner of the request
   */
  isBrandOwner(request, userId) {
    return request.brand_owner_id === userId;
  }
}

// Validation middleware
const validateCreateRequest = [
  // Custom validation to ensure either campaign_id OR bid_id is provided, but not both
  body().custom((value, { req }) => {
    const { campaign_id, bid_id } = req.body;
    if (!campaign_id && !bid_id) {
      throw new Error("Either campaign_id or bid_id is required");
    }
    if (campaign_id && bid_id) {
      throw new Error("Cannot provide both campaign_id and bid_id");
    }
    return true;
  }),

  body("campaign_id")
    .optional()
    .isUUID()
    .withMessage("Invalid campaign ID format"),

  body("bid_id").optional().isUUID().withMessage("Invalid bid ID format"),

  body("proposed_amount")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Proposed amount must be a positive number"),

  body("message")
    .optional()
    .isLength({ min: 1, max: 1000 })
    .withMessage("Message must be between 1 and 1000 characters"),
];

const validateUpdateRequestStatus = [
  body("status")
    .isIn(["pending", "approved", "in_progress", "completed", "rejected"])
    .withMessage("Invalid status"),
];

module.exports = {
  RequestController: new RequestController(),
  validateCreateRequest,
  validateUpdateRequestStatus,
};
