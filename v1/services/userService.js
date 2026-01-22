const { supabaseAdmin } = require("../db/config");

/**
 * User Service
 * Handles business logic for user data retrieval
 */
class UserService {
  /**
   * Get user details with all related data
   * Returns different data based on user role (BRAND_OWNER or INFLUENCER)
   */
  async getUser(userId) {
    try {
      // First, get the user's basic information and role
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("id", userId)
        .eq("is_deleted", false)
        .single();

      if (userError || !user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // Get role-specific data
      if (user.role === "BRAND_OWNER") {
        return await this.getBrandUserData(user);
      } else if (user.role === "INFLUENCER") {
        return await this.getInfluencerUserData(user);
      } else {
        // For other roles (e.g., ADMIN), return basic user data only
        return {
          success: true,
          user: user,
        };
      }
    } catch (err) {
      console.error("[v1/UserService/getUser] Exception:", err);
      return {
        success: false,
        message: "Failed to fetch user data",
        error: err.message,
      };
    }
  }

  /**
   * Get brand user data with related tables
   */
  async getBrandUserData(user) {
    try {
      // Get brand profile
      const { data: brandProfile, error: brandProfileError } =
        await supabaseAdmin
          .from("v1_brand_profiles")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_deleted", false)
          .maybeSingle();

      if (brandProfileError) {
        console.error(
          "[v1/UserService/getBrandUserData] Brand profile error:",
          brandProfileError
        );
      }

      // Get campaigns created by this brand with nested applications
      const { data: campaigns, error: campaignsError } = await supabaseAdmin
        .from("v1_campaigns")
        .select(`
          *,
          v1_applications(
            *
          )
        `)
        .eq("brand_id", user.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (campaignsError) {
        console.error(
          "[v1/UserService/getBrandUserData] Campaigns error:",
          campaignsError
        );
      }

      // Rename v1_applications to applications
      const campaignsWithApplications = (campaigns || []).map(campaign => {
        const { v1_applications, ...campaignData } = campaign;
        return {
          ...campaignData,
          applications: v1_applications || []
        };
      });

      return {
        success: true,
        user: user,
        brand_id: user.id, // Add brand_id explicitly
        brand_profile: brandProfile || null,
        campaigns: campaignsWithApplications,
      };
    } catch (err) {
      console.error(
        "[v1/UserService/getBrandUserData] Exception:",
        err
      );
      return {
        success: false,
        message: "Failed to fetch brand user data",
        error: err.message,
      };
    }
  }

  /**
   * Get influencer user data with related tables
   */
  async getInfluencerUserData(user) {
    try {
      // Get influencer profile
      const { data: influencerProfile, error: influencerProfileError } =
        await supabaseAdmin
          .from("v1_influencer_profiles")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_deleted", false)
          .maybeSingle();

      if (influencerProfileError) {
        console.error(
          "[v1/UserService/getInfluencerUserData] Influencer profile error:",
          influencerProfileError
        );
      }

      // Get social accounts
      const { data: socialAccounts, error: socialAccountsError } =
        await supabaseAdmin
          .from("v1_influencer_social_accounts")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_deleted", false)
          .order("created_at", { ascending: false });

      if (socialAccountsError) {
        console.error(
          "[v1/UserService/getInfluencerUserData] Social accounts error:",
          socialAccountsError
        );
      }

      // Get applications made by this influencer with nested campaign data
      const { data: applications, error: applicationsError } =
        await supabaseAdmin
          .from("v1_applications")
          .select(`
            *,
            v1_campaigns(
              *
            )
          `)
          .eq("influencer_id", user.id)
          .order("created_at", { ascending: false });

      if (applicationsError) {
        console.error(
          "[v1/UserService/getInfluencerUserData] Applications error:",
          applicationsError
        );
      }

      // Rename v1_campaigns to campaign (singular, as each application has one campaign)
      const applicationsWithCampaigns = (applications || []).map(application => {
        const { v1_campaigns, ...applicationData } = application;
        return {
          ...applicationData,
          campaign: v1_campaigns || null
        };
      });

      return {
        success: true,
        user: user,
        influencer_profile: influencerProfile || null,
        social_accounts: socialAccounts || [],
        applications: applicationsWithCampaigns,
      };
    } catch (err) {
      console.error(
        "[v1/UserService/getInfluencerUserData] Exception:",
        err
      );
      return {
        success: false,
        message: "Failed to fetch influencer user data",
        error: err.message,
      };
    }
  }

  /**
   * Get all influencers from v1_users table with pagination
   * Returns simplified influencer data with profiles, social accounts, and categories
   * @param {Object} pagination - Pagination parameters { page, limit }
   */
  async getAllInfluencers(pagination = {}) {
    try {
      const { page = 1, limit = 20 } = pagination;
      
      // Validate pagination parameters
      const validatedPage = Math.max(1, parseInt(page) || 1);
      const validatedLimit = Math.max(1, Math.min(100, parseInt(limit) || 20)); // Max 100 items per page
      const offset = (validatedPage - 1) * validatedLimit;

      // Get all influencer users with pagination
      const { data: influencers, error: influencersError, count } = await supabaseAdmin
        .from("v1_users")
        .select("id, name", { count: "exact" })
        .eq("role", "INFLUENCER")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .range(offset, offset + validatedLimit - 1);

      if (influencersError) {
        console.error(
          "[v1/UserService/getAllInfluencers] Database error:",
          influencersError
        );
        return {
          success: false,
          message: "Failed to fetch influencers",
          error: influencersError.message,
        };
      }

      if (!influencers || influencers.length === 0) {
        return {
          success: true,
          influencers: [],
          pagination: {
            page: validatedPage,
            limit: validatedLimit,
            total: 0,
            totalPages: 0,
          },
        };
      }

      // Get influencer profiles for all influencers
      const userIds = influencers.map((inf) => inf.id);
      
      // Fetch profiles with only required fields
      const profilesResult = await supabaseAdmin
        .from("v1_influencer_profiles")
        .select("user_id, categories, profile_photo_url, languages")
        .in("user_id", userIds)
        .eq("is_deleted", false);
      
      const influencerProfiles = profilesResult.data || [];
      if (profilesResult.error) {
        console.error(
          "[v1/UserService/getAllInfluencers] Profiles error:",
          profilesResult.error
        );
      }

      // Fetch social accounts for all influencers with only required fields
      const socialAccountsResult = await supabaseAdmin
        .from("v1_influencer_social_accounts")
        .select("id, user_id, platform, username, profile_url, follower_count, engagement_rate")
        .in("user_id", userIds)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      let socialAccountsMap = {};
      if (socialAccountsResult.error) {
        console.error(
          "[v1/UserService/getAllInfluencers] Social accounts error:",
          socialAccountsResult.error
        );
      } else if (socialAccountsResult.data) {
        // Group social accounts by user_id
        socialAccountsResult.data.forEach((account) => {
          if (!socialAccountsMap[account.user_id]) {
            socialAccountsMap[account.user_id] = [];
          }
          socialAccountsMap[account.user_id].push({
            id: account.id,
            platform: account.platform,
            username: account.username,
            profile_url: account.profile_url,
            follower_count: account.follower_count,
            engagement_rate: account.engagement_rate,
          });
        });
      }

      // Map profiles to users
      const profileMap = {};
      influencerProfiles.forEach((profile) => {
        profileMap[profile.user_id] = profile;
      });

      // Structure the simplified response
      const influencersWithProfiles = influencers.map((influencer) => {
        const profile = profileMap[influencer.id] || null;
        
        return {
          id: influencer.id,
          name: influencer.name,
          categories: profile?.categories || [],
          profile_photo_url: profile?.profile_photo_url || null,
          languages: profile?.languages || [],
          social_accounts: socialAccountsMap[influencer.id] || [],
        };
      });

      return {
        success: true,
        influencers: influencersWithProfiles,
        pagination: {
          page: validatedPage,
          limit: validatedLimit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / validatedLimit),
        },
      };
    } catch (err) {
      console.error(
        "[v1/UserService/getAllInfluencers] Exception:",
        err
      );
      return {
        success: false,
        message: "Failed to fetch influencers",
        error: err.message,
      };
    }
  }

  /**
   * Get a single influencer by ID
   * Returns simplified influencer data with profile, social accounts, and categories
   * @param {string} influencerId - The influencer user ID
   */
  async getInfluencerById(influencerId) {
    try {
      // Get influencer user
      const { data: influencer, error: influencerError } = await supabaseAdmin
        .from("v1_users")
        .select("id, name")
        .eq("id", influencerId)
        .eq("role", "INFLUENCER")
        .eq("is_deleted", false)
        .single();

      if (influencerError || !influencer) {
        return {
          success: false,
          message: "Influencer not found",
          error: influencerError?.message || "Influencer not found",
        };
      }

      // Fetch profile with only required fields
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("v1_influencer_profiles")
        .select("user_id, categories, profile_photo_url, languages")
        .eq("user_id", influencerId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (profileError) {
        console.error(
          "[v1/UserService/getInfluencerById] Profile error:",
          profileError
        );
      }

      // Fetch social accounts with only required fields
      const { data: socialAccounts, error: socialAccountsError } = await supabaseAdmin
        .from("v1_influencer_social_accounts")
        .select("id, platform, username, profile_url, follower_count, engagement_rate")
        .eq("user_id", influencerId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (socialAccountsError) {
        console.error(
          "[v1/UserService/getInfluencerById] Social accounts error:",
          socialAccountsError
        );
      }

      // Structure the simplified response
      const influencerData = {
        id: influencer.id,
        name: influencer.name,
        categories: profile?.categories || [],
        profile_photo_url: profile?.profile_photo_url || null,
        languages: profile?.languages || [],
        social_accounts: (socialAccounts || []).map((account) => ({
          id: account.id,
          platform: account.platform,
          username: account.username,
          profile_url: account.profile_url,
          follower_count: account.follower_count,
          engagement_rate: account.engagement_rate,
        })),
      };

      return {
        success: true,
        influencer: influencerData,
      };
    } catch (err) {
      console.error(
        "[v1/UserService/getInfluencerById] Exception:",
        err
      );
      return {
        success: false,
        message: "Failed to fetch influencer",
        error: err.message,
      };
    }
  }
}

module.exports = new UserService();

