const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult, query } = require("express-validator");
const {
  uploadImageToStorage,
  deleteImageFromStorage,
} = require("../utils/imageUpload");
const automatedFlowService = require("../utils/automatedFlowService");
const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID || "00000000-0000-0000-0000-000000000000";

class CampaignController {
  /**
   * Enrich campaigns with influencer's request status
   */
  static async enrichWithRequestStatus(campaigns, influencerId) {
    if (!campaigns || !Array.isArray(campaigns) || campaigns.length === 0 || !influencerId) {
      return campaigns;
    }

    const campaignIds = campaigns.map(c => c.id).filter(Boolean);
    if (campaignIds.length === 0) {
      return campaigns;
    }

    // Fetch all requests for this influencer for these campaigns
    const { data: requests, error } = await supabaseAdmin
      .from("requests")
      .select("id, campaign_id, status, proposed_amount, final_agreed_amount, created_at, updated_at")
      .eq("influencer_id", influencerId)
      .in("campaign_id", campaignIds)
      .not("campaign_id", "is", null);

    if (error) {
      console.error("Error fetching request status:", error);
      return campaigns; // Return campaigns without enrichment on error
    }

    // Create a map of campaign_id -> request
    const requestMap = {};
    requests?.forEach(req => {
      if (req.campaign_id && !requestMap[req.campaign_id]) {
        // If multiple requests exist, use the most recent one
        const existing = requestMap[req.campaign_id];
        if (!existing || new Date(req.created_at) > new Date(existing.created_at)) {
          requestMap[req.campaign_id] = req;
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

    // Enrich each campaign with request status
    return campaigns.map(campaign => {
      const request = requestMap[campaign.id];

      if (!request) {
        return {
          ...campaign,
          request_status: "none",
          request_id: null,
          influencer_request: null
        };
      }

      return {
        ...campaign,
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
   * Helper function to ensure campaign titles are present
   */
  static ensureCampaignTitles(campaigns) {
    if (!campaigns) return campaigns;

    const campaignsArray = Array.isArray(campaigns) ? campaigns : [campaigns];

    campaignsArray.forEach(campaign => {
      if (!campaign.title) {
        console.warn(`⚠️ Campaign ${campaign.id} has no title field`);
        campaign.title = "Untitled Campaign";
      }
    });

    return campaigns;
  }

  /**
   * Helper function to add influencer count and proposed amount sum to campaigns
   */
  static addInfluencerStats(campaigns) {
    if (!campaigns) return campaigns;

    const campaignsArray = Array.isArray(campaigns) ? campaigns : [campaigns];

    return campaignsArray.map(campaign => {
      // Extract influencer count from requests_count
      const influencerCount = Array.isArray(campaign.requests_count) && campaign.requests_count[0] && typeof campaign.requests_count[0].count === 'number'
        ? campaign.requests_count[0].count
        : 0;

      // Calculate sum of proposed amounts from requests
      const proposedAmountSum = Array.isArray(campaign.requests)
        ? campaign.requests.reduce((sum, r) => sum + (parseFloat(r.proposed_amount) || 0), 0)
        : 0;

      // Remove the nested requests_count structure and add clean fields
      const { requests_count, requests, ...rest } = campaign;

      return {
        ...rest,
        influencer_count: influencerCount,
        proposed_amount_sum: proposedAmountSum
      };
    });
  }

  /**
   * Create a new campaign
   */
  async createCampaign(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const formData = req.body;

      // Handle image upload if present
      let imageUrl = formData.image_url || formData.image || null;
      if (req.file) {
        const { url, error } = await uploadImageToStorage(
          req.file.buffer,
          req.file.originalname,
          "campaigns"
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

      // Handle both old format (database columns) and new format (form fields)
      const languagesRaw = formData.languages || (formData.language ? [formData.language] : []);
      const categoriesRaw = formData.categories || (formData.category ? [formData.category] : []);
      const locationsRaw = formData.locations || [];

      // Normalize to lowercase
      const languages = Array.isArray(languagesRaw) ? languagesRaw.map(v => String(v).toLowerCase()) : [];
      const categories = Array.isArray(categoriesRaw) ? categoriesRaw.map(v => String(v).toLowerCase()) : [];
      const locations = Array.isArray(locationsRaw) ? locationsRaw.map(v => String(v).toLowerCase()) : [];

      const campaignData = {
        title: formData.name || formData.title,
        description: formData.description || "",
        min_budget: parseFloat(formData.min_budget || formData.budget || 0),
        max_budget: parseFloat(formData.max_budget || formData.budget || 0),
        start_date: formData.start_date || formData.startDate,
        end_date: formData.end_date || formData.expiryDate || formData.endDate,
        campaign_type:
          formData.campaign_type ||
          (formData.category === "product" ? "product" : "service"),
        requirements: formData.requirements || formData.targetAudience || "",
        deliverables:
          formData.deliverables ||
          (formData.contentType ? [formData.contentType] : []),
        // New fields from form
        image_url: imageUrl,
        languages: languages,
        platform: formData.platform || "",
        content_type: formData.content_type || formData.contentType || "",
        categories: categories,
        locations: locations,
        // Package options for product campaigns
        sending_package:
          formData.sending_package ||
          formData.sendingPackageToInfluencer === "yes",
        no_of_packages:
          formData.no_of_packages ||
          (formData.noOfPackages ? parseInt(formData.noOfPackages) : null),
      };

      // Ensure only brand owners can create campaigns
      if (req.user.role !== "brand_owner" && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only brand owners can create campaigns",
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
            message: "Premium subscription required to create campaigns",
            requires_subscription: true,
          });
        }
      }

      console.log("Creating campaign with data:", {
        userId: userId,
        formData: formData,
        campaignData: campaignData,
      });

      const { data: campaign, error } = await supabaseAdmin
        .from("campaigns")
        .insert({
          ...campaignData,
          created_by: userId,
        })
        .select()
        .single();

      if (error) {
        console.error("Database error creating campaign:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to create campaign",
          error: error.message,
        });
      }

      // Emit stats update after campaign creation
      const io = req.app.get("io");
      if (io) {
        const { emitCampaignStatsOnChange } = require('../utils/statsUpdates');
        await emitCampaignStatsOnChange(userId, io);
      }

      console.log("Campaign created successfully:", campaign);
      res.status(201).json({
        success: true,
        campaign: campaign,
        message: "Campaign created successfully",
      });
    } catch (error) {
      console.error("Exception creating campaign:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  /**
   * Get all campaigns with filtering and pagination
   */
  async getCampaigns(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        min_budget,
        max_budget,
        search,
        category,
        type,
        campaign_type,
        // New array filters
        languages,
        locations,
        categories,
        // Logic parameters
        languages_logic,
        locations_logic,
        categories_logic,
        filter_logic
      } = req.query;

      const offset = (page - 1) * limit;

      let baseSelect = supabaseAdmin.from("campaigns").select(`
        *,
        created_by_user:users!campaigns_created_by_fkey (
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
      const { applyCommonFilters, parseArrayParam } = require('../utils/filterHelpers');

      // Apply common filters (budget, languages, locations, categories, search)
      baseSelect = applyCommonFilters(baseSelect, {
        min_budget,
        max_budget,
        languages,
        locations,
        categories: categories || category, // Support both 'categories' and legacy 'category'
        search,
        languages_logic,
        locations_logic,
        categories_logic,
        filter_logic
      });

      // Campaign type filter
      const typeFilter = type || campaign_type;
      if (typeFilter) {
        baseSelect = baseSelect.eq("campaign_type", typeFilter);
      }

      // Role-based server-driven filtering
      if (req.user.role === "influencer") {
        const userId = req.user.id;
        let normalizedStatus = (status || "open").toLowerCase();
        if (normalizedStatus === "new") normalizedStatus = "open";

        // Show all campaigns with the requested status (Global List)
        let query = baseSelect.eq("status", normalizedStatus);

        const {
          data: campaigns,
          error,
          count,
        } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          return res
            .status(500)
            .json({ success: false, message: "Failed to fetch campaigns" });
        }

        const processedCampaigns = CampaignController.addInfluencerStats(
          CampaignController.ensureCampaignTitles(campaigns || [])
        );

        // Add request status for each campaign if user is influencer
        const campaignsWithRequestStatus = await CampaignController.enrichWithRequestStatus(
          processedCampaigns,
          userId
        );

        return res.json({
          success: true,
          campaigns: campaignsWithRequestStatus,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || campaignsWithRequestStatus.length,
            pages: Math.ceil((count || campaignsWithRequestStatus.length) / limit),
          },
        });
      } else if (req.user.role === "brand_owner") {
        // Brand owners only see their own campaigns
        let query = baseSelect.eq("created_by", req.user.id);
        if (status) query = query.eq("status", status);
        const {
          data: campaigns,
          error,
          count,
        } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (error) {
          console.error('❌ [getCampaigns] Brand Owner Database error:', error);
          return res
            .status(500)
            .json({ success: false, message: "Failed to fetch campaigns" });
        }
        // Expired visibility: brand_owner sees by default; others only if include_expired=true
        const includeExpired = String(req.query.include_expired || 'false') === 'true';
        const now = new Date();
        const withExpired = (campaigns || []).map(c => {
          const requestsCount = Array.isArray(c.requests_count) && c.requests_count[0] && typeof c.requests_count[0].count === 'number' ? c.requests_count[0].count : 0;
          const isExpired = (c.status === 'open') && (!requestsCount || requestsCount === 0) && c.end_date && (new Date(c.end_date) < now);
          return { ...c, __expired: isExpired };
        });
        let visible = withExpired.filter(c => true); // brand_owner sees all
        // Sort: expired to last, then newest first
        visible.sort((a, b) => {
          if (a.__expired !== b.__expired) return a.__expired ? 1 : -1;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        const processedCampaigns = CampaignController.addInfluencerStats(
          CampaignController.ensureCampaignTitles(visible)
        );

        // Add request status for each campaign if user is influencer
        const campaignsWithRequestStatus = req.user.role === "influencer"
          ? await CampaignController.enrichWithRequestStatus(processedCampaigns, req.user.id)
          : processedCampaigns;

        return res.json({
          success: true,
          campaigns: campaignsWithRequestStatus,
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
          data: campaigns,
          error,
          count,
        } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (error) {
          return res
            .status(500)
            .json({ success: false, message: "Failed to fetch campaigns" });
        }
        // Expired visibility for non-brand_owner
        const includeExpired = String(req.query.include_expired || 'false') === 'true';
        const now = new Date();
        const withExpired = (campaigns || []).map(c => {
          const requestsCount = Array.isArray(c.requests_count) && c.requests_count[0] && typeof c.requests_count[0].count === 'number' ? c.requests_count[0].count : 0;
          const isExpired = (c.status === 'open') && (!requestsCount || requestsCount === 0) && c.end_date && (new Date(c.end_date) < now);
          return { ...c, __expired: isExpired };
        });
        let visible = withExpired.filter(c => includeExpired ? true : !c.__expired);
        visible.sort((a, b) => {
          if (a.__expired !== b.__expired) return a.__expired ? 1 : -1;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        const processedCampaigns = CampaignController.addInfluencerStats(
          CampaignController.ensureCampaignTitles(visible)
        );

        // Add request status for each campaign if user is influencer
        const campaignsWithRequestStatus = req.user.role === "influencer"
          ? await CampaignController.enrichWithRequestStatus(processedCampaigns, req.user.id)
          : processedCampaigns;

        return res.json({
          success: true,
          campaigns: campaignsWithRequestStatus,
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
   * Get a specific campaign by ID
   */
  async getCampaign(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      let query = null;
      console.log(req.user.role)
      if (req.user.role === "influencer") {
        query = supabaseAdmin
          .from("campaigns")
          .select(
            `
                    *,
                    created_by_user:users!campaigns_created_by_fkey (
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
          .from("campaigns")
          .select(
            `
                    *,
                    created_by_user:users!campaigns_created_by_fkey (
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

      const { data: campaign, error } = await query.single();

      if (error || !campaign) {
        return res.status(404).json({
          success: false,
          message: "Campaign not found",
        });
      }

      // Check access permissions
      if (req.user.role === "brand_owner" && campaign.created_by !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (req.user.role === "influencer") {
        // Check if influencer has interacted with this campaign
        const hasInteraction = campaign.requests.some(
          (request) => request.influencer.id === userId
        );
        if (!hasInteraction && campaign.status !== "open") {
          return res.status(403).json({
            success: false,
            message: "Access denied",
          });
        }
      }

      // Ensure title is present in response
      CampaignController.ensureCampaignTitles(campaign);
      console.log(`📋 Campaign ${campaign.id} title: "${campaign.title}"`);

      res.json({
        success: true,
        campaign: campaign,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Update a campaign
   */
  async updateCampaign(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const userId = req.user.id;
      const formData = req.body;

      // Handle image upload if present
      let imageUrl = null;
      if (req.file) {
        const { url, error } = await uploadImageToStorage(
          req.file.buffer,
          req.file.originalname,
          "campaigns"
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

      // Map frontend form fields to database columns
      const updateData = {};

      if (formData.name !== undefined) updateData.title = formData.name;
      if (formData.description !== undefined)
        updateData.description = formData.description;
      if (formData.min_budget !== undefined)
        updateData.min_budget = parseFloat(formData.min_budget);
      if (formData.max_budget !== undefined)
        updateData.max_budget = parseFloat(formData.max_budget);
      if (formData.budget !== undefined) {
        updateData.min_budget = parseFloat(formData.budget);
        updateData.max_budget = parseFloat(formData.budget);
      }
      if (formData.expiryDate !== undefined)
        updateData.end_date = formData.expiryDate;
      if (formData.campaign_type !== undefined)
        updateData.campaign_type = formData.campaign_type;

      // Handle array fields with normalization
      if (formData.categories !== undefined) {
        const cats = Array.isArray(formData.categories) ? formData.categories : [formData.categories];
        updateData.categories = cats.map(v => String(v).toLowerCase());
      } else if (formData.category !== undefined) {
        updateData.categories = [String(formData.category).toLowerCase()];
      }

      if (formData.languages !== undefined) {
        const langs = Array.isArray(formData.languages) ? formData.languages : [formData.languages];
        updateData.languages = langs.map(v => String(v).toLowerCase());
      } else if (formData.language !== undefined) {
        updateData.languages = [String(formData.language).toLowerCase()];
      }

      if (formData.locations !== undefined) {
        const locs = Array.isArray(formData.locations) ? formData.locations : [formData.locations];
        updateData.locations = locs.map(v => String(v).toLowerCase());
      }

      if (formData.targetAudience !== undefined)
        updateData.requirements = formData.targetAudience;
      if (formData.contentType !== undefined)
        updateData.deliverables = [formData.contentType];
      if (imageUrl !== null) updateData.image_url = imageUrl;
      else if (formData.image !== undefined)
        updateData.image_url = formData.image;
      if (formData.platform !== undefined)
        updateData.platform = formData.platform;
      if (formData.contentType !== undefined)
        updateData.content_type = formData.contentType;
      if (formData.sendingPackageToInfluencer !== undefined)
        updateData.sending_package =
          formData.sendingPackageToInfluencer === "yes";
      if (formData.noOfPackages !== undefined)
        updateData.no_of_packages = formData.noOfPackages
          ? parseInt(formData.noOfPackages)
          : null;

      console.log("Update campaign request:", {
        campaignId: id,
        userId: userId,
        receivedData: formData,
        updateData: updateData,
      });

      // Check if campaign exists and user has permission
      const { data: existingCampaign, error: checkError } = await supabaseAdmin
        .from("campaigns")
        .select("created_by")
        .eq("id", id)
        .single();

      if (checkError || !existingCampaign) {
        return res.status(404).json({
          success: false,
          message: "Campaign not found",
        });
      }

      if (existingCampaign.created_by !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      const { data: campaign, error } = await supabaseAdmin
        .from("campaigns")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("Database error updating campaign:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to update campaign",
          error: error.message,
        });
      }

      console.log("Campaign updated successfully:", campaign);
      res.json({
        success: true,
        campaign: campaign,
        message: "Campaign updated successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete a campaign
   */
  async deleteCampaign(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Check if campaign exists and user has permission
      const { data: existingCampaign, error: checkError } = await supabaseAdmin
        .from("campaigns")
        .select("created_by, image_url, status")
        .eq("id", id)
        .single();

      if (checkError || !existingCampaign) {
        return res.status(404).json({
          success: false,
          message: "Campaign not found",
        });
      }

      if (existingCampaign.created_by !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Prevent deletion if campaign is pending or closed
      if (["pending", "closed"].includes(existingCampaign.status)) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete a campaign that is pending or closed",
        });
      }

      // Delete associated image if it exists
      if (existingCampaign.image_url) {
        await deleteImageFromStorage(existingCampaign.image_url);
      }

      // CASCADE DELETE LOGIC
      // 1. Get all requests for this campaign
      const { data: requests } = await supabaseAdmin
        .from("requests")
        .select("id")
        .eq("campaign_id", id);

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

      const { error } = await supabaseAdmin
        .from("campaigns")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting campaign:", error);
        // Check for foreign key constraint violation
        if (error.code === '23503') {
          return res.status(409).json({
            success: false,
            message: "Cannot delete campaign due to associated records (e.g., transactions, agreements). Please delete related records first.",
          });
        }
        return res.status(500).json({
          success: false,
          message: "Failed to delete campaign",
        });
      }

      // Emit stats updates after deletion
      const io = req.app.get("io");
      if (io && existingCampaign.created_by) {
        const { emitCampaignStatsOnChange } = require('../utils/statsUpdates');
        await emitCampaignStatsOnChange(existingCampaign.created_by, io);
      }

      res.json({
        success: true,
        message: "Campaign deleted successfully",
      });
    } catch (error) {
      console.error("Exception in deleteCampaign:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get campaign statistics
   * 
   * For Influencers:
   * - "new": All open campaigns (status='open')
   * - "pending": Campaigns where influencer has interacted AND campaign.status='pending'
   * - "closed": Campaigns where influencer has interacted AND campaign.status='closed'
   * 
   * For Brand Owners:
   * - "new": All their created campaigns with status='open'
   * - "pending": Their created campaigns with status='pending'
   * - "closed": Their created campaigns with status='closed'
   * 
   * Also includes breakdown by campaign_type (service/product)
   */
  async getCampaignStats(req, res) {
    try {
      const userId = req.user.id;
      const { getCampaignsStatsForUser } = require('../utils/statsUpdates');

      // Use the helper function that reuses listing logic
      const stats = await getCampaignsStatsForUser(userId, req.user.role);

      // Calculate total budget
      let totalBudget = 0;
      if (req.user.role === "admin") {
        // Admin sees all campaigns budget
        const { data: allCampaigns } = await supabaseAdmin
          .from("campaigns")
          .select("budget");

        allCampaigns?.forEach((campaign) => {
          totalBudget += parseFloat(campaign.budget || 0);
        });
      } else if (req.user.role === "brand_owner") {
        const { data: allCampaigns } = await supabaseAdmin
          .from("campaigns")
          .select("budget")
          .eq("created_by", userId);

        allCampaigns?.forEach((campaign) => {
          totalBudget += parseFloat(campaign.budget || 0);
        });
      } else if (req.user.role === "influencer") {
        // For influencers, calculate budget from all campaigns in stats
        const allCampaignIds = new Set();

        // Get open campaigns
        const { data: openCampaigns } = await supabaseAdmin
          .from("campaigns")
          .select("id, budget")
          .eq("status", "open");
        openCampaigns?.forEach(c => {
          allCampaignIds.add(c.id);
          totalBudget += parseFloat(c.budget || 0);
        });

        // Get pending/closed campaigns from requests
        const { data: influencerRequests } = await supabaseAdmin
          .from("requests")
          .select("campaign_id, status")
          .eq("influencer_id", userId)
          .not("campaign_id", "is", null);

        const pendingRequestStatuses = ["connected", "negotiating", "paid", "finalized", "work_submitted", "work_approved"];
        const closedRequestStatuses = ["completed", "cancelled"];

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

        if (pendingCampaignIds.size > 0) {
          const { data: pendingCampaigns } = await supabaseAdmin
            .from("campaigns")
            .select("id, budget")
            .in("id", Array.from(pendingCampaignIds))
            .eq("status", "pending");
          pendingCampaigns?.forEach(c => {
            if (!allCampaignIds.has(c.id)) {
              allCampaignIds.add(c.id);
              totalBudget += parseFloat(c.budget || 0);
            }
          });
        }

        if (closedCampaignIds.size > 0) {
          const { data: closedCampaigns } = await supabaseAdmin
            .from("campaigns")
            .select("id, budget")
            .in("id", Array.from(closedCampaignIds))
            .eq("status", "closed");
          closedCampaigns?.forEach(c => {
            if (!allCampaignIds.has(c.id)) {
              allCampaignIds.add(c.id);
              totalBudget += parseFloat(c.budget || 0);
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
      console.error("Error in getCampaignStats:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Initialize automated conversation for campaign connection
   */
  async initializeCampaignConversation(req, res) {
    try {
      const { campaign_id, influencer_id } = req.body;

      if (!campaign_id || !influencer_id) {
        return res.status(400).json({
          success: false,
          message: "campaign_id and influencer_id are required",
        });
      }

      // Verify user is the brand owner of this campaign
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

      if (campaign.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Only the campaign creator can initialize conversations",
        });
      }

      const result = await automatedFlowService.initializeCampaignConversation(
        campaign_id,
        influencer_id
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to initialize campaign conversation",
          error: result.error,
        });
      }

      res.json({
        success: true,
        message: "Campaign conversation initialized successfully",
        conversation: result.conversation,
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
      });
    } catch (error) {
      console.error("Error initializing campaign conversation:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle automated flow action from campaign influencer
   */
  async handleCampaignInfluencerAction(req, res) {
    try {
      const { conversation_id, action, data, button_id, additional_data } = req.body;

      if (!conversation_id || (!action && !button_id)) {
        return res.status(400).json({
          success: false,
          message: "conversation_id and action or button_id are required",
        });
      }

      // Handle button mapping if button_id is provided OR if action is a button ID
      let mappedAction = action;
      let mappedData = data || {};

      // Check if we have button_id OR if action looks like a button ID
      const buttonToMap = button_id || action;

      if (buttonToMap) {
        console.log("🔍 [DEBUG] Processing campaign influencer button mapping for:", buttonToMap);
        console.log("🔍 [DEBUG] Original action:", action);
        console.log("🔍 [DEBUG] Original data:", data);
        console.log("🔍 [DEBUG] Additional data:", additional_data);
        console.log("🔍 [DEBUG] Button ID provided:", !!button_id);
        console.log("🔍 [DEBUG] Using action as button ID:", !button_id);

        // Map button IDs to automated flow actions (same logic as bid controller)
        if (buttonToMap === 'accept_connection') {
          mappedAction = 'accept_connection';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped accept_connection");
        } else if (buttonToMap === 'reject_connection') {
          mappedAction = 'reject_connection';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped reject_connection");
        } else if (buttonToMap === 'accept_project') {
          mappedAction = 'accept_project';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped accept_project");
        } else if (buttonToMap === 'deny_project') {
          mappedAction = 'deny_project';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped deny_project");
        } else if (buttonToMap === 'accept_price') {
          mappedAction = 'accept_price';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped accept_price");
        } else if (buttonToMap === 'reject_price') {
          mappedAction = 'reject_price';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped reject_price");
        } else if (buttonToMap === 'negotiate_price') {
          mappedAction = 'negotiate_price';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped negotiate_price");
        } else if (buttonToMap === 'send_counter_offer') {
          mappedAction = 'send_counter_offer';
          mappedData = { price: additional_data?.price };
          console.log("🔄 [DEBUG] Mapped send_counter_offer with price:", additional_data?.price);
        } else if (buttonToMap === 'start_work') {
          mappedAction = 'start_work';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped start_work");
        } else if (buttonToMap === 'submit_work') {
          mappedAction = 'submit_work';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped submit_work");
        } else {
          console.log("⚠️ [DEBUG] No special mapping found for button:", buttonToMap);
          // Use additional_data for unmapped buttons
          mappedData = additional_data || {};
        }

        console.log("🔄 [DEBUG] Final mapped action:", mappedAction);
        console.log("🔄 [DEBUG] Final mapped data:", mappedData);
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
          message: "It's not your turn to act",
        });
      }

      const result = await automatedFlowService.handleInfluencerAction(
        conversation_id,
        mappedAction,
        mappedData
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to handle action",
          error: result.error,
        });
      }

      // ✅ Return the complete result structure for automated flow
      res.json({
        success: true,
        conversation: result.conversation,
        message: result.message,
        audit_message: result.audit_message, // Include audit message for sender
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
      });
    } catch (error) {
      console.error("Error handling campaign influencer action:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle automated flow action from campaign brand owner
   */
  async handleCampaignBrandOwnerAction(req, res) {
    try {
      const { conversation_id, action, data, button_id, additional_data } = req.body;

      if (!conversation_id || (!action && !button_id)) {
        return res.status(400).json({
          success: false,
          message: "conversation_id and action or button_id are required",
        });
      }

      // Handle button mapping if button_id is provided OR if action is a button ID
      let mappedAction = action;
      let mappedData = data || {};

      // Check if we have button_id OR if action looks like a button ID
      const buttonToMap = button_id || action;

      if (buttonToMap) {
        console.log("🔍 [DEBUG] Processing campaign brand owner button mapping for:", buttonToMap);
        console.log("🔍 [DEBUG] Original action:", action);
        console.log("🔍 [DEBUG] Original data:", data);
        console.log("🔍 [DEBUG] Additional data:", additional_data);
        console.log("🔍 [DEBUG] Button ID provided:", !!button_id);
        console.log("🔍 [DEBUG] Using action as button ID:", !button_id);

        // Map button IDs to automated flow actions (same logic as bid controller)
        if (buttonToMap === 'agree_negotiation') {
          mappedAction = 'handle_negotiation';
          mappedData = { action: 'agree' };
          console.log("🔄 [DEBUG] Mapped agree_negotiation to handle_negotiation with action: agree");
        } else if (buttonToMap === 'reject_negotiation') {
          mappedAction = 'handle_negotiation';
          mappedData = { action: 'reject' };
          console.log("🔄 [DEBUG] Mapped reject_negotiation to handle_negotiation with action: reject");
        } else if (buttonToMap === 'send_negotiated_price') {
          mappedAction = 'send_negotiated_price';
          mappedData = { price: additional_data?.price ?? mappedData?.price };
          console.log("🔄 [DEBUG] Mapped send_negotiated_price with price:", additional_data?.price);
        } else if (buttonToMap === 'send_project_details') {
          mappedAction = 'send_project_details';
          mappedData = { details: additional_data?.details ?? mappedData?.details };
          console.log("🔄 [DEBUG] Mapped send_project_details with details:", additional_data?.details);
        } else if (buttonToMap === 'send_price_offer') {
          mappedAction = 'send_price_offer';
          mappedData = { price: additional_data?.price ?? mappedData?.price };
          console.log("🔄 [DEBUG] Mapped send_price_offer with price:", additional_data?.price);
        } else if (buttonToMap === 'proceed_to_payment') {
          mappedAction = 'proceed_to_payment';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped proceed_to_payment");
        } else if (buttonToMap === 'accept_counter_offer') {
          mappedAction = 'accept_counter_offer';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped accept_counter_offer");
        } else if (buttonToMap === 'reject_counter_offer') {
          mappedAction = 'reject_counter_offer';
          mappedData = { price: additional_data?.price };
          console.log("🔄 [DEBUG] Mapped reject_counter_offer with price:", additional_data?.price);
        } else if (buttonToMap === 'make_final_offer') {
          mappedAction = 'make_final_offer';
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped make_final_offer");
        } else {
          console.log("⚠️ [DEBUG] No special mapping found for button:", buttonToMap);
          // Use additional_data for unmapped buttons
          mappedData = additional_data || {};
        }

        console.log("🔄 [DEBUG] Final mapped action:", mappedAction);
        console.log("🔄 [DEBUG] Final mapped data:", mappedData);
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
          message: "It's not your turn to act",
        });
      }

      const result = await automatedFlowService.handleBrandOwnerAction(
        conversation_id,
        mappedAction,
        mappedData
      );

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to handle action",
          error: result.error,
        });
      }

      // ✅ Return the complete result structure for automated flow
      res.json({
        success: true,
        conversation: result.conversation,
        message: result.message,
        audit_message: result.audit_message, // Include audit message for sender
        flow_state: result.flow_state,
        awaiting_role: result.awaiting_role,
      });
    } catch (error) {
      console.error("Error handling campaign brand owner action:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Handle work submission for campaign
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
   * Handle work review for campaign
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
        .select("brand_owner_id, influencer_id, campaign_id")
        .eq("id", conversation_id)
        .single();

      if (convError || !conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      if (conversation.brand_owner_id !== userId && conversation.influencer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied"
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
        .select("id, balance_paise")
        .eq("user_id", conversation.influencer_id)
        .single();

      if (walletError || !wallet) {
        return res.status(500).json({
          success: false,
          message: "Failed to get influencer wallet"
        });
      }

      // Escrow-only at verify-time. Ensure wallet exists; no available credit here.
      const enhancedBalanceService = require('../utils/enhancedBalanceService');
      await enhancedBalanceService.getWalletBalance(conversation.influencer_id);

      console.log("✅ [DEBUG] Enhanced balance service: Funds added successfully");

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
              campaign_id: conversation.campaign_id,
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
            bid_id: null,
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
                wallet_id: wallet.id,
                amount: advanceAmountPaise / 100,
                amount_paise: advanceAmountPaise,
                type: "credit",
                status: "pending",
                campaign_id: conversation.campaign_id || null,
                bid_id: null,
                conversation_id: conversation_id,
                payment_stage: "advance",
                admin_payment_tracking_id: adminPaymentRecord.id,
                description: "Advance payment (30% after commission)"
              },
              {
                wallet_id: wallet.id,
                amount: finalAmountPaise / 100,
                amount_paise: finalAmountPaise,
                type: "credit",
                status: "pending",
                campaign_id: conversation.campaign_id || null,
                bid_id: null,
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
            console.warn("⚠️ Escrow freeze failed:", freezeResult.error);
            // Continue anyway as escrow hold is created
          } else {
            console.log("✅ Enhanced balance service: Funds frozen in escrow");
          }
        }
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
        nextFlowState = "payment_completed";
        nextAwaitingRole = "influencer";
      }

      // Update conversation state
      const { error: conversationUpdateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: nextFlowState,
          awaiting_role: nextAwaitingRole,
          chat_status: "real_time",
          flow_data: {
            ...(conversation.flow_data || {}),
            agreed_amount: paymentAmount / 100,
            agreement_timestamp: new Date().toISOString(),
            payment_completed: true,
            payment_timestamp: new Date().toISOString(),
            admin_payment_tracking_id: adminPaymentRecord?.id || null
          }
        })
        .eq("id", conversation_id);

      if (conversationUpdateError) {
        console.error("Conversation update error:", conversationUpdateError);
        return res.status(500).json({ success: false, message: "Failed to update conversation" });
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
      if (adminPaymentRecord) {
        // Admin payment flow: create message with admin action buttons
        const advanceAmount = adminPaymentRecord.advance_amount_paise / 100;
        const finalAmount = adminPaymentRecord.final_amount_paise / 100;
        const totalAmount = adminPaymentRecord.total_amount_paise / 100;
        const commissionAmount = adminPaymentRecord.commission_amount_paise / 100;

        const messageText = `💳 **Payment Received - Admin Processing Required**

💰 **Total Amount:** ₹${totalAmount}
💼 **Commission (${adminPaymentRecord.commission_percentage}%):** ₹${commissionAmount}
💵 **Net Amount:** ₹${adminPaymentRecord.net_amount_paise / 100}

📊 **Payment Breakdown:**
• **Advance Payment:** ₹${advanceAmount} (30%)
• **Final Payment:** ₹${finalAmount} (70%)

⏳ **Status:** Waiting for admin to process advance payment...`;

        const actionData = {
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

        await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id: conversation_id,
            sender_id: SYSTEM_USER_ID,
            receiver_id: null, // Visible to all participants
            message: messageText,
            message_type: "automated",
            action_required: true,
            action_data: actionData
          });

        // Send advance payment notification message to influencer
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
          const io = req.app.get('io');
          if (io && advanceMsg) {
            io.to(`room:${conversation_id}`).emit('chat:new', {
              message: advanceMsg
            });
          }
        }
      } else {
        // Direct payment flow: send payment completion message
        const paymentCompletionMessage = {
          conversation_id: conversation_id,
          sender_id: SYSTEM_USER_ID,
          receiver_id: null, // Visible to all participants
          message: "🎉 **Payment Completed Successfully!**\n\nYour payment has been processed and the collaboration is now active. You can now communicate in real-time.",
          message_type: "automated",
          action_required: false,
        };

        await supabaseAdmin
          .from("messages")
          .insert(paymentCompletionMessage);

        // Also send advance payment notification message to influencer
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
          const io = req.app.get('io');
          if (io && advanceMsg) {
            io.to(`room:${conversation_id}`).emit('chat:new', {
              message: advanceMsg
            });
          }
        }
      }

      // Realtime emits (final contract)
      const io = req.app.get('io');
      if (io) {
        io.to(`room:${conversation_id}`).emit('conversation_state_changed', {
          conversation_id: conversation_id,
          flow_state: nextFlowState,
          awaiting_role: nextAwaitingRole,
          chat_status: 'real_time',
          current_action_data: {},
          updated_at: new Date().toISOString()
        });

        io.to(`user_${conversation.brand_owner_id}`).emit('conversation_list_updated', {
          conversation_id: conversation_id,
          action: 'state_changed',
          flow_state: nextFlowState,
          chat_status: 'real_time',
          timestamp: new Date().toISOString()
        });
        io.to(`user_${conversation.influencer_id}`).emit('conversation_list_updated', {
          conversation_id: conversation_id,
          action: 'state_changed',
          flow_state: nextFlowState,
          chat_status: 'real_time',
          timestamp: new Date().toISOString()
        });

        // Emit stats updates after status change
        if (conversation.brand_owner_id && conversation.influencer_id) {
          const { emitStatsUpdatesToBothUsers } = require('../utils/statsUpdates');
          await emitStatsUpdatesToBothUsers(conversation.brand_owner_id, conversation.influencer_id, io);
        }
      }

      // Send FCM notification for payment completion
      const fcmService = require('../services/fcmService');
      await fcmService.sendFlowStateNotification(
        conversation_id,
        conversation.influencer_id,
        "payment_completed",
        "Payment completed! You can now start working on the campaign."
      );

      res.json({
        success: true,
        message: "Payment verified successfully",
        payment_order: paymentOrder,
        escrow_hold: escrowHold,
        conversation: {
          id: conversation_id,
          flow_state: "payment_completed",
          awaiting_role: "influencer",
          chat_status: "real_time"
        }
      });
    } catch (error) {
      console.error("❌ Error verifying payment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to verify payment",
        error: error.message
      });
    }
  }
}

// Validation middleware
const validateCreateCampaign = [
  // Support both old format (title) and new format (name)
  body("title")
    .optional()
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters"),
  body("name")
    .optional()
    .isLength({ min: 3, max: 200 })
    .withMessage("Name must be between 3 and 200 characters"),
  // Custom validation to ensure at least one of title or name is provided
  body().custom((value) => {
    if (!value.title && !value.name) {
      throw new Error("Either title or name is required");
    }
    return true;
  }),
  body("description")
    .optional()
    .isLength({ max: 2000 })
    .withMessage("Description must be less than 2000 characters"),
  body("min_budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Min budget must be a positive number"),
  body("max_budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Max budget must be a positive number"),
  body("budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Budget must be a positive number"),
  body("start_date")
    .optional()
    .isISO8601()
    .withMessage("Start date must be a valid date"),
  body("end_date")
    .optional()
    .isISO8601()
    .withMessage("End date must be a valid date"),
  body("campaign_type")
    .optional()
    .isIn(["product", "service", "mixed"])
    .withMessage("Campaign type must be product, service, or mixed"),
  body("requirements")
    .optional()
    .isLength({ max: 2000 })
    .withMessage("Requirements must be less than 2000 characters"),
  body("deliverables")
    .optional()
    .isArray()
    .withMessage("Deliverables must be an array"),
  // New form fields
  body("image_url")
    .optional()
    .isURL()
    .withMessage("Image URL must be a valid URL"),
  body("language")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Language must be less than 100 characters"),
  body("platform")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Platform must be less than 100 characters"),
  body("content_type")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Content type must be less than 100 characters"),
  body("category")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Category must be less than 50 characters"),
  body("sending_package")
    .optional()
    .isBoolean()
    .withMessage("Sending package must be a boolean"),
  body("no_of_packages")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Number of packages must be a non-negative integer"),
];

const validateUpdateCampaign = [
  // Support both old format (title) and new format (name)
  body("title")
    .optional()
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters"),
  body("name")
    .optional()
    .isLength({ min: 3, max: 200 })
    .withMessage("Name must be between 3 and 200 characters"),
  body("description")
    .optional()
    .isLength({ max: 2000 })
    .withMessage("Description must be less than 2000 characters"),
  body("budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Budget must be a positive number"),
  body("start_date")
    .optional()
    .isISO8601()
    .withMessage("Start date must be a valid date"),
  body("end_date")
    .optional()
    .isISO8601()
    .withMessage("End date must be a valid date"),
  body("campaign_type")
    .optional()
    .isIn(["product", "service", "mixed"])
    .withMessage("Campaign type must be product, service, or mixed"),
  body("requirements")
    .optional()
    .isLength({ max: 2000 })
    .withMessage("Requirements must be less than 2000 characters"),
  body("deliverables")
    .optional()
    .isArray()
    .withMessage("Deliverables must be an array"),
  // New form fields
  body("image_url")
    .optional()
    .isURL()
    .withMessage("Image URL must be a valid URL"),
  body("language")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Language must be less than 100 characters"),
  body("platform")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Platform must be less than 100 characters"),
  body("content_type")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Content type must be less than 100 characters"),
  body("category")
    .optional()
    .isLength({ min: 0, max: 50 })
    .withMessage("Category must be less than 50 characters"),
  body("sending_package")
    .optional()
    .isBoolean()
    .withMessage("Sending package must be a boolean"),
  body("no_of_packages")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Number of packages must be a non-negative integer"),
];

module.exports = {
  CampaignController: new CampaignController(),
  validateCreateCampaign,
  validateUpdateCampaign,
};

