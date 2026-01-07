const { supabaseAdmin } = require("../db/config");

/**
 * Campaign Service
 * Handles all business logic for campaign CRUD operations
 */
class CampaignService {
  /**
   * Validate campaign status enum
   */
  validateStatus(status) {
    const validStatuses = [
      "DRAFT",
      "LIVE",
      "LOCKED",
      "ACTIVE",
      "COMPLETED",
      "EXPIRED",
      "CANCELLED",
    ];
    return validStatuses.includes(status?.toUpperCase());
  }

  /**
   * Validate campaign type enum
   */
  validateType(type) {
    const validTypes = ["NORMAL", "BULK"];
    return validTypes.includes(type?.toUpperCase());
  }

  /**
   * Normalize status to uppercase
   */
  normalizeStatus(status) {
    if (!status) return "DRAFT";
    return status.toUpperCase();
  }

  /**
   * Normalize type to uppercase
   */
  normalizeType(type) {
    if (!type) return "NORMAL";
    return type.toUpperCase();
  }

  /**
   * Normalize influencer tier
   */
  normalizeTier(tier) {
    if (!tier) return null;
    const normalized = String(tier).toUpperCase().trim();
    const validTiers = ["NANO", "MICRO", "MID", "MACRO"];
    return validTiers.includes(normalized) ? normalized : null;
  }

  /**
   * Check if brand owns the campaign
   */
  async checkBrandOwnership(campaignId, brandId) {
    try {
      const { data, error } = await supabaseAdmin
        .from("v1_campaigns")
        .select("brand_id")
        .eq("id", campaignId)
        .maybeSingle();

      if (error) {
        console.error("[v1/checkBrandOwnership] Error:", error);
        return { success: false, message: "Database error" };
      }

      if (!data) {
        return { success: false, message: "Campaign not found" };
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
        const type = this.normalizeType(campaignData.type);
        if (!this.validateType(type)) {
          return {
            success: false,
            message: "Invalid campaign type. Must be NORMAL or BULK",
          };
        }
  
        // Validate status
        const status = this.normalizeStatus(campaignData.status || "DRAFT");
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
          start_deadline: campaignData.start_deadline, // Required field
          budget: campaignData.budget ?? null,
          // New fields
          description: campaignData.description ?? null,
          cover_image_url: campaignData.cover_image_url ?? null,
          platform: Array.isArray(campaignData.platform) 
            ? campaignData.platform 
            : [],
          content_type: Array.isArray(campaignData.content_type) 
            ? campaignData.content_type 
            : [],
          influencer_tier: this.normalizeTier(campaignData.influencer_tier),
          categories: campaignData.categories ?? null,
          language: campaignData.language ?? null,
          brand_guideline: campaignData.brand_guideline ?? null,
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

      const { page = 1, limit = 20 } = pagination;
      const offset = (page - 1) * limit;

      // Build query
      let query = supabaseAdmin
        .from("v1_campaigns")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      // Apply filters
      if (status) {
        const normalizedStatus = this.normalizeStatus(status);
        if (this.validateStatus(normalizedStatus)) {
          query = query.eq("status", normalizedStatus);
        }
      }

      if (type) {
        const normalizedType = this.normalizeType(type);
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
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        console.error("[v1/getCampaigns] Database error:", error);
        return {
          success: false,
          message: "Failed to fetch campaigns",
          error: error.message,
        };
      }

      // Fetch brand details for all unique brand_ids
      const brandIds = [...new Set((data || []).map(c => c.brand_id).filter(Boolean))];
      let brandMap = {};
      let brandProfileMap = {};

      if (brandIds.length > 0) {
        // Fetch brand users
        const { data: brandUsers, error: brandUsersError } = await supabaseAdmin
          .from("v1_users")
          .select("id, name, email, role")
          .in("id", brandIds)
          .eq("is_deleted", false);

        if (brandUsersError) {
          console.error("[v1/getCampaigns] Brand users fetch error:", brandUsersError);
        } else if (brandUsers) {
          brandUsers.forEach(user => {
            brandMap[user.id] = user;
          });
        }

        // Fetch brand profiles
        const { data: brandProfiles, error: brandProfilesError } = await supabaseAdmin
          .from("v1_brand_profiles")
          .select("*")
          .in("user_id", brandIds)
          .eq("is_deleted", false);

        if (brandProfilesError) {
          console.error("[v1/getCampaigns] Brand profiles fetch error:", brandProfilesError);
        } else if (brandProfiles) {
          brandProfiles.forEach(profile => {
            brandProfileMap[profile.user_id] = profile;
          });
        }
      }

      // Attach brand details to each campaign
      const campaignsWithBrand = (data || []).map(campaign => {
        const brandUser = brandMap[campaign.brand_id] || null;
        const brandProfile = brandProfileMap[campaign.brand_id] || null;

        const brandDetails = brandUser ? {
          brand_id: brandUser.id,
          brand_name: brandUser.name,
          brand_email: brandUser.email,
          brand_role: brandUser.role,
          brand_profile: brandProfile
        } : null;

        return {
          ...campaign,
          brand: brandDetails
        };
      });

      return {
        success: true,
        campaigns: campaignsWithBrand,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
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
   * Includes applications with user data for each application
   */
  async getCampaignById(campaignId, userId = null) {
    try {
      // Fetch the campaign
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("*")
        .eq("id", campaignId)
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

      // Fetch all applications for this campaign
      const { data: applications, error: applicationsError } = await supabaseAdmin
        .from("v1_applications")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });

      if (applicationsError) {
        console.error("[v1/getCampaignById] Applications fetch error:", applicationsError);
        // Continue without applications if there's an error
      }

      // Fetch user data for each influencer who applied
      let applicationsWithUsers = [];
      if (applications && applications.length > 0) {
        const influencerIds = [...new Set(applications.map(app => app.influencer_id).filter(Boolean))];
        
        let userMap = {};
        if (influencerIds.length > 0) {
          const { data: users, error: usersError } = await supabaseAdmin
            .from("v1_users")
            .select("id, name, email, phone_number, role, created_at, updated_at, is_deleted")
            .in("id", influencerIds)
            .eq("is_deleted", false);

          if (usersError) {
            console.error("[v1/getCampaignById] Users fetch error:", usersError);
          } else if (users) {
            // Create a map for quick lookup
            users.forEach(user => {
              userMap[user.id] = user;
            });
          }
        }

        // Attach user data to each application
        applicationsWithUsers = applications.map(application => ({
          ...application,
          user: userMap[application.influencer_id] || null
        }));
      }

      // Return campaign with applications array
      return {
        success: true,
        campaign: {
          ...campaign,
          applications: applicationsWithUsers
        },
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
   * Includes applications for each campaign with full influencer details and social accounts
   */
  async getBrandCampaigns(brandId, filters = {}, pagination = {}) {
    try {
      // Add brand_id filter
      const brandFilters = { ...filters, brand_id: brandId };
      const result = await this.getCampaigns(brandFilters, pagination);
      
      if (!result.success || !result.campaigns || result.campaigns.length === 0) {
        return result;
      }

      // Get all campaign IDs
      const campaignIds = result.campaigns.map(campaign => campaign.id);

      if (campaignIds.length === 0) {
        return {
          success: true,
          campaigns: result.campaigns,
          pagination: result.pagination,
        };
      }

      // Fetch all applications for these campaigns
      const { data: applications, error: applicationsError } = await supabaseAdmin
        .from("v1_applications")
        .select("*")
        .in("campaign_id", campaignIds)
        .order("created_at", { ascending: false });

      if (applicationsError) {
        console.error("[v1/getBrandCampaigns] Applications fetch error:", applicationsError);
        // Continue without applications if there's an error
      }

      // If we have applications, fetch influencer data for each unique influencer
      let influencerMap = {};
      let influencerProfileMap = {};
      let socialAccountsMap = {};
      
      if (applications && applications.length > 0) {
        const influencerIds = [...new Set(applications.map(app => app.influencer_id).filter(Boolean))];
        
        if (influencerIds.length > 0) {
          // Fetch full influencer user data
          const { data: influencers, error: influencersError } = await supabaseAdmin
            .from("v1_users")
           .select("id, name, email, phone_number, role, created_at, updated_at, is_deleted")
            .in("id", influencerIds)
            .eq("is_deleted", false);

          if (influencersError) {
            console.error("[v1/getBrandCampaigns] Influencers fetch error:", influencersError);
          } else if (influencers) {
            // Create a map for quick lookup
            influencers.forEach(influencer => {
              influencerMap[influencer.id] = influencer;
            });
          }

          // Fetch influencer profiles
          const { data: influencerProfiles, error: influencerProfilesError } = await supabaseAdmin
            .from("v1_influencer_profiles")
            .select("*")
            .in("user_id", influencerIds)
            .eq("is_deleted", false);

          if (influencerProfilesError) {
            console.error("[v1/getBrandCampaigns] Influencer profiles fetch error:", influencerProfilesError);
          } else if (influencerProfiles) {
            // Create a map for quick lookup
            influencerProfiles.forEach(profile => {
              influencerProfileMap[profile.user_id] = profile;
            });
          }

          // Fetch social accounts for all influencers
          const { data: socialAccounts, error: socialAccountsError } = await supabaseAdmin
            .from("v1_influencer_social_accounts")
            .select("*")
            .in("user_id", influencerIds)
            .eq("is_deleted", false)
            .order("created_at", { ascending: false });

          if (socialAccountsError) {
            console.error("[v1/getBrandCampaigns] Social accounts fetch error:", socialAccountsError);
          } else if (socialAccounts) {
            // Group social accounts by user_id
            socialAccounts.forEach(account => {
              if (!socialAccountsMap[account.user_id]) {
                socialAccountsMap[account.user_id] = [];
              }
              socialAccountsMap[account.user_id].push(account);
            });
          }
        }
      }

      // Group applications by campaign_id and attach influencer data
      const applicationsByCampaign = {};
      if (applications && applications.length > 0) {
        applications.forEach(application => {
          const campaignId = application.campaign_id;
          if (!applicationsByCampaign[campaignId]) {
            applicationsByCampaign[campaignId] = [];
          }
          
          const influencerId = application.influencer_id;
          const influencer = influencerMap[influencerId] || null;
          const influencerProfile = influencerProfileMap[influencerId] || null;
          const socialAccounts = socialAccountsMap[influencerId] || [];
          
          // Attach influencer data, profile, and social accounts to application
          const applicationWithInfluencer = {
            ...application,
            influencer: influencer ? {
              ...influencer,
              profile: influencerProfile,
              social_accounts: socialAccounts
            } : null
          };
          
          applicationsByCampaign[campaignId].push(applicationWithInfluencer);
        });
      }

      // Attach applications to each campaign
      const campaignsWithApplications = result.campaigns.map(campaign => ({
        ...campaign,
        applications: applicationsByCampaign[campaign.id] || []
      }));

      return {
        success: true,
        campaigns: campaignsWithApplications,
        pagination: result.pagination,
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
          const type = this.normalizeType(updateData.type);
          if (!this.validateType(type)) {
            return {
              success: false,
              message: "Invalid campaign type. Must be NORMAL or BULK",
            };
          }
          update.type = type;
        }
  
        if (updateData.status !== undefined) {
          const status = this.normalizeStatus(updateData.status);
          if (!this.validateStatus(status)) {
            return {
              success: false,
              message: "Invalid campaign status",
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
  
        if (updateData.start_deadline !== undefined) {
          update.start_deadline = updateData.start_deadline;
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
          update.influencer_tier = this.normalizeTier(updateData.influencer_tier);
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

      // Hard delete
      const { error } = await supabaseAdmin
        .from("v1_campaigns")
        .delete()
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

}

module.exports = new CampaignService();
