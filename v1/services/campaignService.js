const { supabaseAdmin } = require("../db/config");
const {
  normalizeTier,
  normalizeCampaignType,
  normalizeCampaignStatus,
} = require("../utils/enumNormalizer");
const { CampaignStatus, CampaignType, ApplicationPhase, PaymentStatus } = require("../utils/constants");

/**
 * Campaign Service
 * Handles all business logic for campaign CRUD operations
 */
class CampaignService {
  /**
   * Validate campaign status enum
   */
  validateStatus(status) {
    const { VALID_CAMPAIGN_STATUSES } = require("../utils/constants");
    return VALID_CAMPAIGN_STATUSES.includes(status?.toUpperCase());
  }

  /**
   * Validate campaign type enum
   */
  validateType(type) {
    const { VALID_CAMPAIGN_TYPES } = require("../utils/constants");
    return VALID_CAMPAIGN_TYPES.includes(type?.toUpperCase());
  }

  /**
   * Normalize status to uppercase
   */
  normalizeStatus(status) {
    if (!status) return CampaignStatus.DRAFT;
    return normalizeCampaignStatus(status) || CampaignStatus.DRAFT;
  }

  /**
   * Normalize type to uppercase
   */
  normalizeType(type) {
    if (!type) return CampaignType.NORMAL;
    return normalizeCampaignType(type) || CampaignType.NORMAL;
  }

  /**
   * Normalize influencer tier
   */
  normalizeTier(tier) {
    return normalizeTier(tier);
  }

  /**
   * Check if brand owns the campaign
   */
  async checkBrandOwnership(campaignId, brandId) {
    try {
      const { data, error } = await supabaseAdmin
        .from("v1_campaigns")
        .select("brand_id, is_deleted")
        .eq("id", campaignId)
        .maybeSingle();

      if (error) {
        console.error("[v1/checkBrandOwnership] Error:", error);
        return { success: false, message: "Database error" };
      }

      if (!data) {
        return { success: false, message: "Campaign not found" };
      }

      if (data.is_deleted) {
        return { success: false, message: "Campaign already deleted" };
      }

      if (data.brand_id !== brandId) {
        return { success: false, message: "Unauthorized: Not your campaign" };
      }

      return { success: true };
    } catch (err) {
      console.error("[v1/checkBrandOwnership] Exception:", err);
      return { success: false, message: "Internal server error" };
    }
  }

    /**
   * Create a new campaign (Brand Owner only)
   */
    async createCampaign(brandId, campaignData) {
      try {
        // Validate type
        const type = normalizeCampaignType(campaignData.type) || "NORMAL";
        if (!this.validateType(type)) {
          return {
            success: false,
            message: "Invalid campaign type. Must be NORMAL or BULK",
          };
        }
  
        // Validate status
        const status = normalizeCampaignStatus(campaignData.status) || CampaignStatus.DRAFT;
        if (!this.validateStatus(status)) {
          return {
            success: false,
            message: "Invalid campaign status",
          };
        }
  
        // Validate min/max influencers
        if (
          campaignData.min_influencers !== undefined &&
          campaignData.max_influencers !== undefined
        ) {
          if (campaignData.min_influencers > campaignData.max_influencers) {
            return {
              success: false,
              message: "min_influencers cannot be greater than max_influencers",
            };
          }
        }

        // Fetch non-expired admin settings to get commission_percentage
        let platformFeePercentage = null;
        let platformFeeAmount = null;
        let netAmount = null;
        const budget = campaignData.budget ?? null;

        if (budget !== null && budget > 0) {
          const { data: adminSettings, error: adminSettingsError } = await supabaseAdmin
            .from("v1_admin_settings")
            .select("commission_percentage")
            .eq("is_expired", false)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (adminSettingsError) {
            console.error("[v1/createCampaign] Error fetching admin settings:", adminSettingsError);
            return {
              success: false,
              message: "Failed to fetch admin settings",
              error: adminSettingsError.message,
            };
          }

          if (!adminSettings || !adminSettings.commission_percentage) {
            return {
              success: false,
              message: "No active admin settings found. Please configure commission percentage first.",
            };
          }

          // Use commission_percentage as platform_fee_percentage
          platformFeePercentage = parseFloat(adminSettings.commission_percentage);
          
          // Calculate platform_fee_amount and net_amount
          // Amounts remain in rupees (not converted to paisa)
          platformFeeAmount = (budget * platformFeePercentage) / 100;
          netAmount = budget - platformFeeAmount;
        }
  
        // Build campaign object
        const campaign = {
          brand_id: brandId,
          title: campaignData.title,
          type: type,
          status: status,
          min_influencers: campaignData.min_influencers ?? null,
          max_influencers: campaignData.max_influencers ?? null,
          accepted_count: 0, // Always start at 0
          requires_script: campaignData.requires_script || false,
          budget: budget,
          platform_fee_percentage: platformFeePercentage,
          platform_fee_amount: platformFeeAmount,
          net_amount: netAmount,
          // New fields
          description: campaignData.description ?? null,
          cover_image_url: campaignData.cover_image_url ?? null,
          platform: Array.isArray(campaignData.platform) 
            ? campaignData.platform 
            : [],
          content_type: Array.isArray(campaignData.content_type) 
            ? campaignData.content_type 
            : [],
          influencer_tier: normalizeTier(campaignData.influencer_tier),
          categories: campaignData.categories ?? null,
          language: campaignData.language ?? null,
          brand_guideline: campaignData.brand_guideline ?? null,
          // Deadline fields
          work_deadline: campaignData.work_deadline ?? null,
          script_deadline: campaignData.script_deadline ?? null,
          applications_accepted_till: campaignData.applications_accepted_till ?? null,
          buffer_days: campaignData.buffer_days ?? 0,
        };
  
        // Insert campaign
        const { data, error } = await supabaseAdmin
          .from("v1_campaigns")
          .insert(campaign)
          .select()
          .single();
  
        if (error) {
          console.error("[v1/createCampaign] Database error:", error);
          return {
            success: false,
            message: "Failed to create campaign",
            error: error.message,
          };
        }
  
        return {
          success: true,
          campaign: data,
          message: "Campaign created successfully",
        };
      } catch (err) {
        console.error("[v1/createCampaign] Exception:", err);
        return {
          success: false,
          message: "Internal server error",
          error: err.message,
        };
      }
    }

  /**
   * Get all campaigns with filtering and pagination
   * Influencers can see all campaigns, Brand owners see their own + all
   */
  async getCampaigns(filters = {}, pagination = {}) {
    try {
      const { status, type, brand_id, min_budget, max_budget, search } =
        filters;

      // Accept offset + limit for infinite scroll support
      const { limit = 20, offset = 0 } = pagination;
      
      // Validate pagination parameters
      const validatedLimit = Math.max(1, Math.min(100, parseInt(limit) || 20)); // Max 100 items
      const validatedOffset = Math.max(0, parseInt(offset) || 0);

      // Build query - select only required fields
      let query = supabaseAdmin
        .from("v1_campaigns")
        .select("id, title, cover_image_url, budget, platform, content_type, brand_id", { count: "exact" })
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      // Apply filters
      if (status) {
        const normalizedStatus = normalizeCampaignStatus(status) || "DRAFT";
        if (this.validateStatus(normalizedStatus)) {
          query = query.eq("status", normalizedStatus);
        }
      }

      if (type) {
        const normalizedType = normalizeCampaignType(type) || "NORMAL";
        if (this.validateType(normalizedType)) {
          query = query.eq("type", normalizedType);
        }
      }

      if (brand_id) {
        query = query.eq("brand_id", brand_id);
      }

      if (min_budget !== undefined) {
        query = query.gte("budget", min_budget);
      }

      if (max_budget !== undefined) {
        query = query.lte("budget", max_budget);
      }

      if (search) {
        query = query.ilike("title", `%${search}%`);
      }

      // Apply pagination
      query = query.range(validatedOffset, validatedOffset + validatedLimit - 1);

      const { data, error, count } = await query;

      if (error) {
        console.error("[v1/getCampaigns] Database error:", error);
        return {
          success: false,
          message: "Failed to fetch campaigns",
          error: error.message,
        };
      }

      // Fetch brand details for all unique brand_ids - only get id and name
      const brandIds = [...new Set((data || []).map(c => c.brand_id).filter(Boolean))];
      let brandMap = {};

      if (brandIds.length > 0) {
        // Fetch brand users - only get id and name
        const { data: brandUsers, error: brandUsersError } = await supabaseAdmin
          .from("v1_users")
          .select("id, name")
          .in("id", brandIds)
          .eq("is_deleted", false);

        if (brandUsersError) {
          console.error("[v1/getCampaigns] Brand users fetch error:", brandUsersError);
        } else if (brandUsers) {
          brandUsers.forEach(user => {
            brandMap[user.id] = user;
          });
        }
      }

      // Attach brand details to each campaign - simplified structure
      // Filter out campaigns where brand owner is deleted
      const campaignsWithBrand = (data || [])
        .filter(campaign => brandMap[campaign.brand_id]) // Only include campaigns with non-deleted brand owners
        .map(campaign => {
          const brandUser = brandMap[campaign.brand_id];

          const brand = {
            id: brandUser.id,
            brand_name: brandUser.name
          };

          return {
            id: campaign.id,
            title: campaign.title,
            cover_image_url: campaign.cover_image_url,
            budget: campaign.budget,
            platform: campaign.platform,
            content_type: campaign.content_type,
            brand: brand
          };
        });

      const hasMore = (validatedOffset + validatedLimit) < (count || 0);

      return {
        success: true,
        campaigns: campaignsWithBrand,
        pagination: {
          limit: validatedLimit,
          offset: validatedOffset,
          count: campaignsWithBrand.length,
          total: count || 0,
          hasMore,
        },
      };
    } catch (err) {
      console.error("[v1/getCampaigns] Exception:", err);
      return {
        success: false,
        message: "Internal server error",
        error: err.message,
      };
    }
  }

  /**
   * Get single campaign by ID
   * Returns only essential fields with applications and influencer data
   */
  async getCampaignById(campaignId, userId = null) {
    try {
      // Fetch the campaign - select only required fields
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("id, title, cover_image_url, description, status, type, budget, platform, content_type, buffer_days, requires_script, language, work_deadline, script_deadline, applications_accepted_till, brand_id")
        .eq("id", campaignId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (campaignError) {
        console.error("[v1/getCampaignById] Database error:", campaignError);
        return {
          success: false,
          message: "Failed to fetch campaign",
          error: campaignError.message,
        };
      }

      if (!campaign) {
        return {
          success: false,
          message: "Campaign not found",
        };
      }

      // Check if brand owner is deleted
      const { data: brandUser, error: brandUserError } = await supabaseAdmin
        .from("v1_users")
        .select("id, is_deleted")
        .eq("id", campaign.brand_id)
        .maybeSingle();

      if (brandUserError || !brandUser || brandUser.is_deleted) {
        return {
          success: false,
          message: "Campaign not found",
        };
      }

      // Get deadline fields from campaign
      const workDeadline = campaign.work_deadline || null;
      const scriptDeadline = campaign.script_deadline || null;

      // Fetch all applications for this campaign - only required fields
      const { data: applications, error: applicationsError } = await supabaseAdmin
        .from("v1_applications")
        .select("id, phase, created_at, influencer_id")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });

      if (applicationsError) {
        console.error("[v1/getCampaignById] Applications fetch error:", applicationsError);
        // Continue without applications if there's an error
      }

      // Fetch influencer data for each application
      let applicationsWithInfluencers = [];
      if (applications && applications.length > 0) {
        const influencerIds = [...new Set(applications.map(app => app.influencer_id).filter(Boolean))];
        
        let userMap = {};
        let profileMap = {};
        let socialAccountsMap = {};

        if (influencerIds.length > 0) {
          // Fetch user data - only id and name
          const { data: users, error: usersError } = await supabaseAdmin
            .from("v1_users")
            .select("id, name")
            .in("id", influencerIds)
            .eq("is_deleted", false);

          if (usersError) {
            console.error("[v1/getCampaignById] Users fetch error:", usersError);
          } else if (users) {
            users.forEach(user => {
              userMap[user.id] = user;
            });
          }

          // Fetch influencer profiles - only profile_photo_url
          const { data: profiles, error: profilesError } = await supabaseAdmin
            .from("v1_influencer_profiles")
            .select("user_id, profile_photo_url")
            .in("user_id", influencerIds)
            .eq("is_deleted", false);

          if (profilesError) {
            console.error("[v1/getCampaignById] Profiles fetch error:", profilesError);
          } else if (profiles) {
            profiles.forEach(profile => {
              profileMap[profile.user_id] = profile;
            });
          }

          // Fetch social accounts - only platform and followers_count
          const { data: socialAccounts, error: socialAccountsError } = await supabaseAdmin
            .from("v1_influencer_social_accounts")
            .select("user_id, platform, followers_count")
            .in("user_id", influencerIds)
            .eq("is_deleted", false)
            .order("created_at", { ascending: false });

          if (socialAccountsError) {
            console.error("[v1/getCampaignById] Social accounts fetch error:", socialAccountsError);
          } else if (socialAccounts) {
            socialAccounts.forEach(account => {
              if (!socialAccountsMap[account.user_id]) {
                socialAccountsMap[account.user_id] = [];
              }
              socialAccountsMap[account.user_id].push({
                platform: account.platform,
                followers: account.followers_count
              });
            });
          }
        }

        // Build applications with influencer data
        applicationsWithInfluencers = applications.map(application => {
          const influencerId = application.influencer_id;
          const user = userMap[influencerId] || null;
          const profile = profileMap[influencerId] || null;

          return {
            id: application.id,
            phase: application.phase,
            created_at: application.created_at,
            influencer: user ? {
              id: user.id,
              name: user.name,
              profile_photo_url: profile?.profile_photo_url || null,
              social_accounts: socialAccountsMap[influencerId] || []
            } : null
          };
        });
      }

      // Build response with only required fields
      const response = {
        id: campaign.id,
        title: campaign.title,
        cover_image_url: campaign.cover_image_url,
        description: campaign.description,
        status: campaign.status,
        type: campaign.type,
        budget: campaign.budget,
        platform: campaign.platform,
        content_type: campaign.content_type,
        applications_accepted_till: campaign.applications_accepted_till || null,
        requires_script: campaign.requires_script || false,
        script_deadline: scriptDeadline,
        work_deadline: workDeadline,
        buffer_days: campaign.buffer_days || null,
        languages: campaign.language ? (Array.isArray(campaign.language) ? campaign.language : [campaign.language]) : null,
        location: null, // Field doesn't exist in schema
        applications: applicationsWithInfluencers
      };

      return {
        success: true,
        campaign: response,
      };
    } catch (err) {
      console.error("[v1/getCampaignById] Exception:", err);
      return {
        success: false,
        message: "Internal server error",
        error: err.message,
      };
    }
  }

  /**
   * Get campaigns created by a specific brand owner
   * Returns simplified campaign list with counts by status and pagination
   */
  async getBrandCampaigns(brandId, filters = {}, pagination = {}) {
    try {
      const { status, type, min_budget, max_budget, search } = filters;
      
      // Accept offset + limit for infinite scroll support
      const { limit = 20, offset = 0 } = pagination;

      // Validate pagination parameters
      const validatedLimit = Math.max(1, Math.min(100, parseInt(limit) || 20)); // Max 100 items
      const validatedOffset = Math.max(0, parseInt(offset) || 0);

      // Build base query for campaigns with count
      let query = supabaseAdmin
        .from("v1_campaigns")
        .select("id, title, cover_image_url, type, budget, status, language, created_at", { count: "exact" })
        .eq("brand_id", brandId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      // Apply filters
      if (status) {
        const normalizedStatus = normalizeCampaignStatus(status) || "DRAFT";
        if (this.validateStatus(normalizedStatus)) {
          query = query.eq("status", normalizedStatus);
        }
      }

      if (type) {
        const normalizedType = normalizeCampaignType(type) || "NORMAL";
        if (this.validateType(normalizedType)) {
          query = query.eq("type", normalizedType);
        }
      }

      if (min_budget !== undefined) {
        query = query.gte("budget", min_budget);
      }

      if (max_budget !== undefined) {
        query = query.lte("budget", max_budget);
      }

      if (search) {
        query = query.ilike("title", `%${search}%`);
      }

      // Apply pagination
      query = query.range(validatedOffset, validatedOffset + validatedLimit - 1);

      // Fetch campaigns and get counts in parallel for better performance
      const [campaignsResult, ...countResults] = await Promise.all([
        query,
        // Get total count (unfiltered)
        supabaseAdmin
          .from("v1_campaigns")
          .select("*", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .eq("is_deleted", false),
        // Get live campaigns count
        supabaseAdmin
          .from("v1_campaigns")
          .select("*", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .eq("is_deleted", false)
          .eq("status", "LIVE"),
        // Get in-progress campaigns count
        supabaseAdmin
          .from("v1_campaigns")
          .select("*", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .eq("is_deleted", false)
          .eq("status", "IN_PROGRESS"),
        // Get completed campaigns count
        supabaseAdmin
          .from("v1_campaigns")
          .select("*", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .eq("is_deleted", false)
          .eq("status", "COMPLETED"),
      ]);

      const { data: campaigns, error: campaignsError, count: totalCount } = campaignsResult;

      if (campaignsError) {
        console.error("[v1/getBrandCampaigns] Database error:", campaignsError);
        return {
          success: false,
          message: "Failed to fetch campaigns",
          error: campaignsError.message,
        };
      }

      // Extract count results
      const [
        { count: count_total_campaigns, error: totalCountError },
        { count: count_live_campaigns, error: liveCountError },
        { count: count_in_progress_campaigns, error: inProgressCountError },
        { count: count_completed_campaigns, error: completedCountError },
      ] = countResults;

      // Log count errors but don't fail the request
      if (totalCountError) {
        console.error("[v1/getBrandCampaigns] Total count error:", totalCountError);
      }
      if (liveCountError) {
        console.error("[v1/getBrandCampaigns] Live count error:", liveCountError);
      }
      if (inProgressCountError) {
        console.error("[v1/getBrandCampaigns] In-progress count error:", inProgressCountError);
      }
      if (completedCountError) {
        console.error("[v1/getBrandCampaigns] Completed count error:", completedCountError);
      }

      // Format campaigns - ensure language is returned as array or null
      const formattedCampaigns = (campaigns || []).map(campaign => ({
        id: campaign.id,
        title: campaign.title,
        cover_image_url: campaign.cover_image_url,
        type: campaign.type,
        budget: campaign.budget,
        status: campaign.status,
        language: campaign.language ? (Array.isArray(campaign.language) ? campaign.language : [campaign.language]) : null,
        created_at: campaign.created_at
      }));

      const hasMore = (validatedOffset + validatedLimit) < (totalCount || 0);

      return {
        success: true,
        campaigns: formattedCampaigns,
        count_total_campaigns: count_total_campaigns || 0,
        count_live_campaigns: count_live_campaigns || 0,
        count_in_progress_campaigns: count_in_progress_campaigns || 0,
        count_completed_campaigns: count_completed_campaigns || 0,
        pagination: {
          limit: validatedLimit,
          offset: validatedOffset,
          count: formattedCampaigns.length,
          total: totalCount || 0,
          hasMore,
        },
      };
    } catch (err) {
      console.error("[v1/getBrandCampaigns] Exception:", err);
      return {
        success: false,
        message: "Internal server error",
        error: err.message,
      };
    }
  }

    /**
   * Update campaign (Brand Owner only)
   */
    async updateCampaign(campaignId, brandId, updateData) {
      try {
        // Check ownership
        const ownershipCheck = await this.checkBrandOwnership(
          campaignId,
          brandId
        );
        if (!ownershipCheck.success) {
          return ownershipCheck;
        }
  
        // Build update object (only include provided fields)
        const update = {};
  
        if (updateData.title !== undefined) {
          update.title = updateData.title;
        }
  
        if (updateData.type !== undefined) {
          const type = normalizeCampaignType(updateData.type) || "NORMAL";
          if (!this.validateType(type)) {
            return {
              success: false,
              message: "Invalid campaign type. Must be NORMAL or BULK",
            };
          }
          update.type = type;
        }
  
        if (updateData.status !== undefined) {
          const status = normalizeCampaignStatus(updateData.status) || "DRAFT";
          if (!this.validateStatus(status)) {
            return {
              success: false,
              message: "Invalid campaign status",
            };
          }
          // Prevent manual completion - campaigns can only be completed automatically
          if (status === CampaignStatus.COMPLETED) {
            return {
              success: false,
              message: "Campaign status cannot be manually set to COMPLETED. Campaigns are completed automatically when all work is submitted.",
            };
          }
          update.status = status;
        }
  
        if (updateData.min_influencers !== undefined) {
          update.min_influencers = updateData.min_influencers;
        }
  
        if (updateData.max_influencers !== undefined) {
          update.max_influencers = updateData.max_influencers;
        }
  
        // Validate min/max if both are being updated
        if (
          update.min_influencers !== undefined &&
          update.max_influencers !== undefined
        ) {
          if (update.min_influencers > update.max_influencers) {
            return {
              success: false,
              message: "min_influencers cannot be greater than max_influencers",
            };
          }
        }
  
        if (updateData.requires_script !== undefined) {
          update.requires_script = updateData.requires_script;
        }
  
        if (updateData.budget !== undefined) {
          update.budget = updateData.budget ?? null;
        }
  
        // New fields
        if (updateData.description !== undefined) {
          update.description = updateData.description ?? null;
        }
  
        if (updateData.cover_image_url !== undefined) {
          update.cover_image_url = updateData.cover_image_url ?? null;
        }
  
        if (updateData.platform !== undefined) {
          update.platform = Array.isArray(updateData.platform) 
            ? updateData.platform 
            : [];
        }
  
        if (updateData.content_type !== undefined) {
          update.content_type = Array.isArray(updateData.content_type) 
            ? updateData.content_type 
            : [];
        }
  
        if (updateData.influencer_tier !== undefined) {
          update.influencer_tier = normalizeTier(updateData.influencer_tier);
        }
  
        if (updateData.categories !== undefined) {
          update.categories = updateData.categories ?? null;
        }
  
        if (updateData.language !== undefined) {
          update.language = updateData.language ?? null;
        }
  
        if (updateData.brand_guideline !== undefined) {
          update.brand_guideline = updateData.brand_guideline ?? null;
        }
  
        // Deadline fields
        if (updateData.work_deadline !== undefined) {
          update.work_deadline = updateData.work_deadline ?? null;
        }
  
        if (updateData.script_deadline !== undefined) {
          update.script_deadline = updateData.script_deadline ?? null;
        }
  
        if (updateData.applications_accepted_till !== undefined) {
          update.applications_accepted_till = updateData.applications_accepted_till ?? null;
        }
  
        if (updateData.buffer_days !== undefined) {
          update.buffer_days = updateData.buffer_days ?? 0;
        }

        // If no updates, return early
        if (Object.keys(update).length === 0) {
          return {
            success: false,
            message: "No valid fields to update",
          };
        }
  
        // Update campaign
        const { data, error } = await supabaseAdmin
          .from("v1_campaigns")
          .update(update)
          .eq("id", campaignId)
          .select()
          .single();
  
        if (error) {
          console.error("[v1/updateCampaign] Database error:", error);
          return {
            success: false,
            message: "Failed to update campaign",
            error: error.message,
          };
        }
  
        return {
          success: true,
          campaign: data,
          message: "Campaign updated successfully",
        };
      } catch (err) {
        console.error("[v1/updateCampaign] Exception:", err);
        return {
          success: false,
          message: "Internal server error",
          error: err.message,
        };
      }
    }

  /**
   * Delete campaign (Brand Owner only)
   * Soft deletes by setting is_deleted = true
   * Campaign (NORMAL or BULK) can only be deleted if:
   * - All applications are in APPLIED or COMPLETED state
   * - No applications in ACCEPTED, SCRIPT, WORK, PAYOUT, or CANCELLED states
   */
  async deleteCampaign(campaignId, brandId) {
    try {
      // Check ownership
      const ownershipCheck = await this.checkBrandOwnership(
        campaignId,
        brandId
      );
      if (!ownershipCheck.success) {
        return ownershipCheck;
      }

      // Check if campaign has any applications
      // Campaign can only be deleted if all applications are in APPLIED or COMPLETED state
      const { data: allApplications, error: appsError } = await supabaseAdmin
        .from("v1_applications")
        .select("id, phase")
        .eq("campaign_id", campaignId);

      if (appsError) {
        console.error("[v1/deleteCampaign] Error fetching applications:", appsError);
        return {
          success: false,
          message: "Failed to validate campaign deletion",
          error: appsError.message,
        };
      }

      if (!allApplications || allApplications.length === 0) {
        // No applications, safe to delete
      } else {
        // Check if all applications are in allowed states for deletion
        // Allowed states: APPLIED, COMPLETED
        // Not allowed: ACCEPTED, SCRIPT, WORK, PAYOUT, CANCELLED
        const allowedPhases = ["APPLIED", "COMPLETED"];
        const invalidApplications = allApplications.filter(app => 
          !allowedPhases.includes(app.phase)
        );

        if (invalidApplications.length > 0) {
          const invalidPhases = [...new Set(invalidApplications.map(app => app.phase))];
          return {
            success: false,
            message: `Cannot delete campaign. All applications must be in APPLIED or COMPLETED state. Found applications in: ${invalidPhases.join(", ")}`,
          };
        }
      }

      // Soft delete - set is_deleted = true
      const { error } = await supabaseAdmin
        .from("v1_campaigns")
        .update({ is_deleted: true })
        .eq("id", campaignId);

      if (error) {
        console.error("[v1/deleteCampaign] Database error:", error);
        return {
          success: false,
          message: "Failed to delete campaign",
          error: error.message,
        };
      }

      return {
        success: true,
        message: "Campaign deleted successfully",
      };
    } catch (err) {
      console.error("[v1/deleteCampaign] Exception:", err);
      return {
        success: false,
        message: "Internal server error",
        error: err.message,
      };
    }
  }

  /**
   * Check and complete NORMAL campaign when work is submitted
   */
  async completeNormalCampaignOnWorkSubmission(campaignId, applicationId) {
    try {
      // Get campaign details
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("id, status, is_deleted")
        .eq("id", campaignId)
        .maybeSingle();

      if (campaignError) {
        console.error("[v1/completeNormalCampaignOnWorkSubmission] Campaign fetch error:", campaignError);
        return { success: false, error: campaignError.message };
      }

      if (!campaign || campaign.is_deleted) {
        return { success: false, message: "Campaign not found or deleted" };
      }

      if (campaign.status === CampaignStatus.COMPLETED) {
        return { success: true, message: "Campaign already completed" };
      }

      // Check if application has work accepted (is in PAYOUT phase)
      const { data: application, error: appError } = await supabaseAdmin
        .from("v1_applications")
        .select("id, phase")
        .eq("id", applicationId)
        .maybeSingle();

      if (appError) {
        console.error("[v1/completeNormalCampaignOnWorkSubmission] Application fetch error:", appError);
        return { success: false, error: appError.message };
      }

      if (!application) {
        return { success: false, message: "Application not found" };
      }

      // If application is in PAYOUT phase (work accepted), complete the campaign
      if (application.phase === ApplicationPhase.PAYOUT) {
        const { error: updateError } = await supabaseAdmin
          .from("v1_campaigns")
          .update({ status: CampaignStatus.COMPLETED })
          .eq("id", campaignId);

        if (updateError) {
          console.error("[v1/completeNormalCampaignOnWorkSubmission] Update error:", updateError);
          return { success: false, error: updateError.message };
        }

        return { 
          success: true, 
          message: "NORMAL campaign auto-completed successfully",
          campaignCompleted: true
        };
      }

      return { success: true, message: "Application work not yet accepted" };
    } catch (err) {
      console.error("[v1/completeNormalCampaignOnWorkSubmission] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check and complete BULK campaign when all selected applications' work is submitted
   */
  async completeBulkCampaignOnWorkSubmission(campaignId) {
    try {
      // Get all selected applications for this campaign
      // Selected applications are those in v1_application_payments with verified CAMPAIGN payments
      const { data: selectedApplications, error: selectedError } = await supabaseAdmin
        .from("v1_application_payments")
        .select(`
          application_id,
          v1_applications!inner(
            campaign_id
          ),
          v1_payment_orders!inner(
            status,
            payable_type,
            payable_id
          )
        `)
        .eq("v1_applications.campaign_id", campaignId)
        .eq("v1_payment_orders.payable_type", "CAMPAIGN")
        .eq("v1_payment_orders.payable_id", campaignId)
        .eq("v1_payment_orders.status", PaymentStatus.VERIFIED);

      if (selectedError) {
        console.error("[v1/completeBulkCampaignOnWorkSubmission] Selected applications fetch error:", selectedError);
        return { success: false, error: selectedError.message };
      }

      if (!selectedApplications || selectedApplications.length === 0) {
        return { success: true, message: "No selected applications found for bulk campaign" };
      }

      // Get application IDs that are selected
      const selectedApplicationIds = selectedApplications.map(sa => sa.application_id);

      // Get all selected applications and check their phases
      const { data: applications, error: appsError } = await supabaseAdmin
        .from("v1_applications")
        .select("id, phase")
        .eq("campaign_id", campaignId)
        .in("id", selectedApplicationIds);

      if (appsError) {
        console.error("[v1/completeBulkCampaignOnWorkSubmission] Applications fetch error:", appsError);
        return { success: false, error: appsError.message };
      }

      if (!applications || applications.length === 0) {
        return { success: true, message: "No applications found" };
      }

      // Check if all selected applications have work accepted (are in PAYOUT or COMPLETED phase)
      const allWorkAccepted = applications.every(app => 
        app.phase === ApplicationPhase.PAYOUT || app.phase === ApplicationPhase.COMPLETED
      );

      if (allWorkAccepted) {
        // Update campaign status to COMPLETED
        const { error: updateError } = await supabaseAdmin
          .from("v1_campaigns")
          .update({ status: CampaignStatus.COMPLETED })
          .eq("id", campaignId);

        if (updateError) {
          console.error("[v1/completeBulkCampaignOnWorkSubmission] Update error:", updateError);
          return { success: false, error: updateError.message };
        }

        return { 
          success: true, 
          message: "BULK campaign auto-completed successfully",
          campaignCompleted: true
        };
      }

      return { success: true, message: "Not all selected applications have work accepted yet" };
    } catch (err) {
      console.error("[v1/completeBulkCampaignOnWorkSubmission] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check and auto-complete campaigns when work is submitted
   * Routes to appropriate method based on campaign type
   */
  async checkAndCompleteCampaignOnWorkSubmission(campaignId, applicationId) {
    try {
      // Get campaign details
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("id, type, status, is_deleted")
        .eq("id", campaignId)
        .maybeSingle();

      if (campaignError) {
        console.error("[v1/checkAndCompleteCampaignOnWorkSubmission] Campaign fetch error:", campaignError);
        return { success: false, error: campaignError.message };
      }

      if (!campaign || campaign.is_deleted) {
        return { success: false, message: "Campaign not found or deleted" };
      }

      // Don't update if already completed
      if (campaign.status === CampaignStatus.COMPLETED) {
        return { success: true, message: "Campaign already completed" };
      }

      // Route to appropriate completion method
      if (campaign.type === CampaignType.NORMAL) {
        return await this.completeNormalCampaignOnWorkSubmission(campaignId, applicationId);
      } else if (campaign.type === CampaignType.BULK) {
        return await this.completeBulkCampaignOnWorkSubmission(campaignId);
      }

      return { success: false, message: "Unknown campaign type" };
    } catch (err) {
      console.error("[v1/checkAndCompleteCampaignOnWorkSubmission] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Move campaign from LIVE to IN_PROGRESS when first application is accepted
   * This should be called after accepting an application
   */
  async moveCampaignToInProgress(campaignId) {
    try {
      // Get campaign details
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("id, status, is_deleted")
        .eq("id", campaignId)
        .maybeSingle();

      if (campaignError) {
        console.error("[v1/moveCampaignToInProgress] Campaign fetch error:", campaignError);
        return { success: false, error: campaignError.message };
      }

      if (!campaign || campaign.is_deleted) {
        return { success: false, message: "Campaign not found or deleted" };
      }

      // Only move from LIVE to IN_PROGRESS
      if (campaign.status === CampaignStatus.LIVE) {
        const { error: updateError } = await supabaseAdmin
          .from("v1_campaigns")
          .update({ status: CampaignStatus.IN_PROGRESS })
          .eq("id", campaignId);

        if (updateError) {
          console.error("[v1/moveCampaignToInProgress] Update error:", updateError);
          return { success: false, error: updateError.message };
        }

        return { 
          success: true, 
          message: "Campaign moved to IN_PROGRESS successfully",
          statusChanged: true
        };
      }

      // If already IN_PROGRESS or other status, no change needed
      return { 
        success: true, 
        message: `Campaign already in ${campaign.status} status, no change needed`,
        statusChanged: false
      };
    } catch (err) {
      console.error("[v1/moveCampaignToInProgress] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check and expire campaigns that have passed their applications_accepted_till timestamp without any accepted applications
   * This should be called periodically (e.g., via cron job or scheduled task)
   * A campaign expires if:
   * 1. It's in LIVE status
   * 2. applications_accepted_till has passed
   * 3. No applications have been accepted (accepted_count = 0)
   */
  async checkAndExpireCampaigns() {
    try {
      const now = new Date().toISOString();

      // Find campaigns that:
      // 1. Are in LIVE status
      // 2. Have applications_accepted_till set
      // 3. applications_accepted_till has passed
      // 4. Have no accepted applications (accepted_count = 0)
      const { data: expiredCampaigns, error: fetchError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("id, title, applications_accepted_till, accepted_count")
        .eq("status", CampaignStatus.LIVE)
        .not("applications_accepted_till", "is", null)
        .lt("applications_accepted_till", now)
        .eq("accepted_count", 0)
        .eq("is_deleted", false);

      if (fetchError) {
        console.error("[v1/checkAndExpireCampaigns] Fetch error:", fetchError);
        return { success: false, error: fetchError.message };
      }

      if (!expiredCampaigns || expiredCampaigns.length === 0) {
        return { success: true, message: "No campaigns to expire", expiredCount: 0 };
      }

      // Update all expired campaigns to EXPIRED status
      const campaignIds = expiredCampaigns.map(c => c.id);
      const { error: updateError } = await supabaseAdmin
        .from("v1_campaigns")
        .update({ status: CampaignStatus.EXPIRED })
        .in("id", campaignIds);

      if (updateError) {
        console.error("[v1/checkAndExpireCampaigns] Update error:", updateError);
        return { success: false, error: updateError.message };
      }

      console.log(`[v1/checkAndExpireCampaigns] Expired ${expiredCampaigns.length} campaigns: ${campaignIds.join(", ")}`);

      return { 
        success: true, 
        message: `Expired ${expiredCampaigns.length} campaigns successfully`,
        expiredCount: expiredCampaigns.length,
        expiredCampaignIds: campaignIds
      };
    } catch (err) {
      console.error("[v1/checkAndExpireCampaigns] Exception:", err);
      return { success: false, error: err.message };
    }
  }

}

module.exports = new CampaignService();
