const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult, query } = require("express-validator");
const {
  uploadImageToStorage,
  deleteImageFromStorage,
} = require("../utils/imageUpload");
const automatedFlowService = require("../utils/automatedFlowService");

class CampaignController {
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
        language: formData.language || "",
        platform: formData.platform || "",
        content_type: formData.content_type || formData.contentType || "",
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
      } = req.query;

      const offset = (page - 1) * limit;
      let baseSelect = supabaseAdmin.from("campaigns").select(`
                    *,
                    created_by_user:users!campaigns_created_by_fkey (
                        id,
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
      const typeFilter = type || campaign_type;
      if (typeFilter) {
        baseSelect = baseSelect.eq("campaign_type", typeFilter);
      }

      // Role-based server-driven filtering
      if (req.user.role === "influencer") {
        const userId = req.user.id;
        const normalizedStatus = (status || "open").toLowerCase();

        // Fetch all campaign_ids this influencer has interacted with
        const { data: influencerRequests } = await supabaseAdmin
          .from("requests")
          .select("campaign_id, status")
          .eq("influencer_id", userId)
          .not("campaign_id", "is", null);

        const interactedCampaignIds = (influencerRequests || [])
          .map((r) => r.campaign_id)
          .filter(Boolean);

        if (normalizedStatus === "open" || normalizedStatus === "new") {
          // Open/new: show all open campaigns (including interacted)
          let query = baseSelect.eq("status", "open");
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
          return res.json({
            success: true,
            campaigns: campaigns || [],
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: count || (campaigns || []).length,
              pages: Math.ceil((count || (campaigns || []).length) / limit),
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

          // Collect campaign ids that have a matching request status for this influencer
          const filteredIds = (influencerRequests || [])
            .filter(
              (r) => r.campaign_id && allowedReqStatuses.includes(r.status)
            )
            .map((r) => r.campaign_id);
          const idsSet = new Set(filteredIds);
          if (idsSet.size === 0) {
            return res.json({
              success: true,
              campaigns: [],
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
          const { data: campaigns, error } = await query
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) {
            return res
              .status(500)
              .json({ success: false, message: "Failed to fetch campaigns" });
          }
          return res.json({
            success: true,
            campaigns: campaigns || [],
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: (campaigns || []).length,
              pages: Math.ceil((campaigns || []).length / limit),
            },
          });
        } else {
          // Default: treat as open
          let query = baseSelect.eq("status", "open");
          const { data: campaigns, error } = await query
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) {
            return res
              .status(500)
              .json({ success: false, message: "Failed to fetch campaigns" });
          }
          const interactedSet = new Set(interactedCampaignIds);
          const filtered = (campaigns || []).filter(
            (c) => !interactedSet.has(c.id)
          );
          return res.json({
            success: true,
            campaigns: filtered,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: filtered.length,
              pages: Math.ceil(filtered.length / limit),
            },
          });
        }
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
          return res
            .status(500)
            .json({ success: false, message: "Failed to fetch campaigns" });
        }
        return res.json({
          success: true,
          campaigns: campaigns,
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
        return res.json({
          success: true,
          campaigns: campaigns,
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

      if(req.user.role === "influencer") {
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
      if (formData.category !== undefined)
        updateData.campaign_type =
          formData.category === "product" ? "product" : "service";
      if (formData.targetAudience !== undefined)
        updateData.requirements = formData.targetAudience;
      if (formData.contentType !== undefined)
        updateData.deliverables = [formData.contentType];
      if (imageUrl !== null) updateData.image_url = imageUrl;
      else if (formData.image !== undefined)
        updateData.image_url = formData.image;
      if (formData.language !== undefined)
        updateData.language = formData.language;
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
        .select("created_by, image_url")
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

      // Delete associated image if it exists
      if (existingCampaign.image_url) {
        await deleteImageFromStorage(existingCampaign.image_url);
      }

      const { error } = await supabaseAdmin
        .from("campaigns")
        .delete()
        .eq("id", id);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to delete campaign",
        });
      }

      res.json({
        success: true,
        message: "Campaign deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get campaign statistics
   */
  async getCampaignStats(req, res) {
    try {
      const userId = req.user.id;

      let queryBuilder = supabaseAdmin
        .from("campaigns")
        .select("status, budget");

      // Apply role-based filtering
      if (req.user.role === "brand_owner") {
        queryBuilder = queryBuilder.eq("created_by", userId);
      } else if (req.user.role === "influencer") {
        // Get campaigns where influencer has requests
        queryBuilder = supabaseAdmin
          .from("requests")
          .select(
            `
                        campaigns (
                            status,
                            budget
                        )
                    `
          )
          .eq("influencer_id", userId);
      }

      const { data, error } = await queryBuilder;

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch statistics",
        });
      }

      // Calculate statistics
      const campaigns =
        req.user.role === "influencer"
          ? data.map((item) => item.campaigns).filter(Boolean)
          : data;

      const stats = {
        total: campaigns.length,
        byStatus: {},
        totalBudget: 0,
      };

      campaigns.forEach((campaign) => {
        // Status stats
        stats.byStatus[campaign.status] =
          (stats.byStatus[campaign.status] || 0) + 1;

        // Budget
        stats.totalBudget += parseFloat(campaign.budget || 0);
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
          mappedData = { price: additional_data?.price };
          console.log("🔄 [DEBUG] Mapped send_negotiated_price with price:", additional_data?.price);
        } else if (buttonToMap === 'send_project_details') {
          mappedAction = 'send_project_details';
          mappedData = { details: additional_data?.details };
          console.log("🔄 [DEBUG] Mapped send_project_details with details:", additional_data?.details);
        } else if (buttonToMap === 'send_price_offer') {
          mappedAction = 'send_price_offer';
          mappedData = { price: additional_data?.price };
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
          mappedData = additional_data || {};
          console.log("🔄 [DEBUG] Mapped reject_counter_offer");
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
        paymentAmount = Math.round((request?.final_agreed_amount || 1000) * 100); // Convert to paise
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

      // Use enhanced balance service to add funds properly
      console.log("🔍 [DEBUG] Starting wallet fund addition process...");
      console.log("🔍 [DEBUG] Influencer ID:", conversation.influencer_id);
      console.log("🔍 [DEBUG] Payment amount (paise):", paymentAmount);
      console.log("🔍 [DEBUG] Conversation ID:", conversation_id);
      
      const enhancedBalanceService = require('../utils/enhancedBalanceService');
      
      // First check if wallet exists
      console.log("🔍 [DEBUG] Checking if wallet exists for influencer...");
      const walletCheckResult = await enhancedBalanceService.getWalletBalance(conversation.influencer_id);
      console.log("🔍 [DEBUG] Wallet check result:", walletCheckResult);
      
      const addFundsResult = await enhancedBalanceService.addFunds(
        conversation.influencer_id,
        paymentAmount,
        {
          conversation_id: conversation_id,
          razorpay_order_id: razorpay_order_id,
          razorpay_payment_id: razorpay_payment_id,
          conversation_type: conversation.campaign_id ? "campaign" : "bid",
          brand_owner_id: conversation.brand_owner_id,
          bid_id: conversation.bid_id,
          campaign_id: conversation.campaign_id,
          notes: `Payment received for ${conversation.campaign_id ? 'campaign' : 'bid'} collaboration`
        }
      );

      console.log("🔍 [DEBUG] Enhanced balance service result:", addFundsResult);

      if (!addFundsResult.success) {
        console.error("❌ [DEBUG] Enhanced balance service error:", addFundsResult.error);
        console.error("❌ [DEBUG] Full error details:", JSON.stringify(addFundsResult, null, 2));
        return res.status(500).json({
          success: false,
          message: "Failed to add funds to wallet",
          debug: {
            error: addFundsResult.error,
            influencer_id: conversation.influencer_id,
            payment_amount: paymentAmount,
            conversation_id: conversation_id
          }
        });
      }

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

      // Update conversation to payment completed and real-time chat
      const { error: conversationUpdateError } = await supabaseAdmin
        .from("conversations")
        .update({
          flow_state: "payment_completed",
          awaiting_role: "influencer",
          chat_status: "real_time"
        })
        .eq("id", conversation_id);

      if (conversationUpdateError) {
        console.error("Conversation update error:", conversationUpdateError);
        return res.status(500).json({ success: false, message: "Failed to update conversation" });
      }

      // Transaction records are already created by enhancedBalanceService.addFunds()
      // and enhancedBalanceService.freezeFunds() calls above

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
        transaction: transaction,
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
