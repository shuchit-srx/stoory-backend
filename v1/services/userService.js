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
      // Filter out deleted applications and applications with deleted campaigns
      const { data: applications, error: applicationsError } =
        await supabaseAdmin
          .from("v1_applications")
          .select(`
            *,
            v1_campaigns!inner(
              *,
              is_deleted
            )
          `)
          .eq("influencer_id", user.id)
          .eq("is_deleted", false)
          .eq("v1_campaigns.is_deleted", false)
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
      // Accept offset + limit for infinite scroll support
      const { limit = 20, offset = 0 } = pagination;
      
      // Validate pagination parameters
      const validatedLimit = Math.max(1, Math.min(100, parseInt(limit) || 20)); // Max 100 items
      const validatedOffset = Math.max(0, parseInt(offset) || 0);

      // Get all influencer users with pagination
      const { data: influencers, error: influencersError, count } = await supabaseAdmin
        .from("v1_users")
        .select("id, name", { count: "exact" })
        .eq("role", "INFLUENCER")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .range(validatedOffset, validatedOffset + validatedLimit - 1);

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
            limit: validatedLimit,
            offset: validatedOffset,
            count: 0,
            total: 0,
            hasMore: false,
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

      const hasMore = (validatedOffset + validatedLimit) < (count || 0);

      return {
        success: true,
        influencers: influencersWithProfiles,
        pagination: {
          limit: validatedLimit,
          offset: validatedOffset,
          count: influencersWithProfiles.length,
          total: count || 0,
          hasMore,
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

      // Fetch portfolio items with only required fields
      const { data: portfolios, error: portfoliosError } = await supabaseAdmin
        .from("v1_influencer_portfolio")
        .select("id, thumbnail_url, media_url, media_type, description, duration_seconds, created_at")
        .eq("user_id", influencerId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (portfoliosError) {
        console.error(
          "[v1/UserService/getInfluencerById] Portfolio error:",
          portfoliosError
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
        portfolios: (portfolios || []).map((portfolio) => ({
          id: portfolio.id,
          thumbnail_url: portfolio.thumbnail_url,
          media_url: portfolio.media_url,
          media_type: portfolio.media_type,
          description: portfolio.description,
          duration: portfolio.duration_seconds,
          created_at: portfolio.created_at,
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

  /**
   * Soft delete user account (marks v1_users.is_deleted = true)
   * Applies role-based guardrails:
   * - BRAND_OWNER: cannot delete if they have any non-COMPLETED campaign with accepted applications
   * - INFLUENCER: cannot delete if they have accepted applications where work is not submitted yet
   *              if any application is in PAYOUT phase, allow deletion but return a warning message
   */
  async deleteUser(userId) {
    try {
      if (!userId) {
        return {
          success: false,
          statusCode: 400,
          message: "User ID is required",
        };
      }

      // Ensure user exists and is not already deleted
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role, is_deleted")
        .eq("id", userId)
        .maybeSingle();

      if (userError) {
        console.error("[v1/UserService/deleteUser] User fetch error:", userError);
        return {
          success: false,
          statusCode: 500,
          message: "Failed to validate user account",
          error: userError.message,
        };
      }

      if (!user) {
        return {
          success: false,
          statusCode: 404,
          message: "User not found",
        };
      }

      if (user.is_deleted) {
        return {
          success: false,
          statusCode: 400,
          message: "User account is already deleted",
        };
      }

      if (user.role === "BRAND_OWNER") {
        const guard = await this.validateBrandOwnerDeletion(userId);
        if (!guard.success) return guard;

        return await this.performSoftDelete(userId, user.role);
      } else if (user.role === "INFLUENCER") {
        const guard = await this.validateInfluencerDeletion(userId);
        if (!guard.success) return guard;

        // Guard may return a warning to surface after deletion
        const deleted = await this.performSoftDelete(userId, user.role);
        if (!deleted.success) return deleted;

        if (guard.warning) {
          return {
            ...deleted,
            warning: true,
            message: guard.message,
            pendingPayoutsCount: guard.pendingPayoutsCount,
          };
        }

        return deleted;
      }

      // For other roles (e.g., ADMIN), allow deletion without extra checks
      return await this.performSoftDelete(userId, user.role);
    } catch (err) {
      console.error("[v1/UserService/deleteUser] Exception:", err);
      return {
        success: false,
        statusCode: 500,
        message: "Failed to delete user account",
        error: err.message,
      };
    }
  }

  async validateBrandOwnerDeletion(userId) {
    try {
      // Block if any non-COMPLETED campaign has an accepted-ish application
      const acceptedPhases = ["ACCEPTED", "SCRIPT", "WORK", "PAYOUT"];

      const { data: campaigns, error } = await supabaseAdmin
        .from("v1_campaigns")
        .select(
          `
          id,
          title,
          status,
          v1_applications!inner(
            id,
            phase
          )
        `
        )
        .eq("brand_id", userId)
        .eq("is_deleted", false)
        .neq("status", "COMPLETED")
        .in("v1_applications.phase", acceptedPhases);

      if (error) {
        console.error(
          "[v1/UserService/validateBrandOwnerDeletion] Campaign fetch error:",
          error
        );
        return {
          success: false,
          statusCode: 500,
          message: "Failed to validate deletion",
          error: error.message,
        };
      }

      if (campaigns && campaigns.length > 0) {
        const campaignTitles = campaigns
          .map((c) => c.title)
          .filter(Boolean)
          .slice(0, 5);

        return {
          success: false,
          statusCode: 400,
          message:
            "Cannot delete account. You have active campaigns with accepted applications. Please wait until those campaigns are completed before deleting your account.",
          details: {
            activeCampaignsCount: campaigns.length,
            campaignTitles,
          },
        };
      }

      return { success: true };
    } catch (err) {
      console.error(
        "[v1/UserService/validateBrandOwnerDeletion] Exception:",
        err
      );
      return {
        success: false,
        statusCode: 500,
        message: "Failed to validate brand owner deletion",
        error: err.message,
      };
    }
  }

  async validateInfluencerDeletion(userId) {
    try {
      // Get all applications for this influencer
      const { data: applications, error } = await supabaseAdmin
        .from("v1_applications")
        .select(
          `
          id,
          phase,
          campaign_id,
          v1_campaigns(
            id,
            title
          )
        `
        )
        .eq("influencer_id", userId)
        .eq("is_deleted", false);

      if (error) {
        console.error(
          "[v1/UserService/validateInfluencerDeletion] Applications error:",
          error
        );
        return {
          success: false,
          statusCode: 500,
          message: "Failed to validate deletion",
          error: error.message,
        };
      }

      const apps = applications || [];
      if (apps.length === 0) {
        // No applications, safe to delete
        return { success: true };
      }

      // Influencer can only delete account if ALL applications are in APPLIED, PAYOUT, or COMPLETED phase
      const allowedPhases = ["APPLIED", "PAYOUT", "COMPLETED"];
      const invalidApplications = apps.filter((a) => !allowedPhases.includes(a.phase));

      if (invalidApplications.length > 0) {
        const invalidPhases = [...new Set(invalidApplications.map((a) => a.phase))];
        const campaignTitles = invalidApplications
          .map((a) => a.v1_campaigns?.title)
          .filter(Boolean)
          .slice(0, 5);

        return {
          success: false,
          statusCode: 400,
          message: `Cannot delete account. All applications must be in APPLIED, PAYOUT, or COMPLETED phase. Found applications in: ${invalidPhases.join(", ")}`,
          details: {
            activeApplicationsCount: invalidApplications.length,
            campaignTitles,
            invalidPhases,
          },
        };
      }

      // Check if there are any applications in PAYOUT phase to show warning
      const payoutApps = apps.filter((a) => a.phase === "PAYOUT");
      if (payoutApps.length > 0) {
        return {
          success: true,
          warning: true,
          pendingPayoutsCount: payoutApps.length,
          message: `Account deleted successfully. Note: You have ${payoutApps.length} pending payout(s). Pending payouts will be processed irrespective of account deletion.`,
        };
      }

      return { success: true };
    } catch (err) {
      console.error(
        "[v1/UserService/validateInfluencerDeletion] Exception:",
        err
      );
      return {
        success: false,
        statusCode: 500,
        message: "Failed to validate influencer deletion",
        error: err.message,
      };
    }
  }

  async performSoftDelete(userId, role = null) {
    try {
      const nowIso = new Date().toISOString();

      // Soft delete related rows first (so user deletion doesn't hide related updates)
      if (role === "BRAND_OWNER") {
        const { error: brandProfileError } = await supabaseAdmin
          .from("v1_brand_profiles")
          .update({ is_deleted: true, updated_at: nowIso })
          .eq("user_id", userId)
          .eq("is_deleted", false);

        if (brandProfileError) {
          console.error(
            "[v1/UserService/performSoftDelete] Brand profile update error:",
            brandProfileError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to delete user account",
            error: brandProfileError.message,
          };
        }

        // Soft delete all campaigns created by this brand owner
        const { error: campaignsError } = await supabaseAdmin
          .from("v1_campaigns")
          .update({ is_deleted: true })
          .eq("brand_id", userId)
          .eq("is_deleted", false);

        if (campaignsError) {
          console.error(
            "[v1/UserService/performSoftDelete] Campaigns update error:",
            campaignsError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to delete user account",
            error: campaignsError.message,
          };
        }
      }

      if (role === "INFLUENCER") {
        const { error: influencerProfileError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .update({ is_deleted: true, updated_at: nowIso })
          .eq("user_id", userId)
          .eq("is_deleted", false);

        if (influencerProfileError) {
          console.error(
            "[v1/UserService/performSoftDelete] Influencer profile update error:",
            influencerProfileError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to delete user account",
            error: influencerProfileError.message,
          };
        }

        const { error: socialAccountsError } = await supabaseAdmin
          .from("v1_influencer_social_accounts")
          .update({ is_deleted: true, updated_at: nowIso })
          .eq("user_id", userId)
          .eq("is_deleted", false);

        if (socialAccountsError) {
          console.error(
            "[v1/UserService/performSoftDelete] Influencer social accounts update error:",
            socialAccountsError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to delete user account",
            error: socialAccountsError.message,
          };
        }

        // v1_influencer_portfolio has no updated_at in schema; only soft delete
        const { error: portfolioError } = await supabaseAdmin
          .from("v1_influencer_portfolio")
          .update({ is_deleted: true })
          .eq("user_id", userId)
          .eq("is_deleted", false);

        if (portfolioError) {
          console.error(
            "[v1/UserService/performSoftDelete] Influencer portfolio update error:",
            portfolioError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to delete user account",
            error: portfolioError.message,
          };
        }

        // Soft delete all applications created by this influencer
        const { error: applicationsError } = await supabaseAdmin
          .from("v1_applications")
          .update({ is_deleted: true })
          .eq("influencer_id", userId)
          .eq("is_deleted", false);

        if (applicationsError) {
          console.error(
            "[v1/UserService/performSoftDelete] Applications update error:",
            applicationsError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to delete user account",
            error: applicationsError.message,
          };
        }
      }

      // Finally, soft delete the user record
      const { error } = await supabaseAdmin
        .from("v1_users")
        .update({
          is_deleted: true,
          updated_at: nowIso,
        })
        .eq("id", userId)
        .eq("is_deleted", false);

      if (error) {
        console.error("[v1/UserService/performSoftDelete] Update error:", error);
        return {
          success: false,
          statusCode: 500,
          message: "Failed to delete user account",
          error: error.message,
        };
      }

      return {
        success: true,
        statusCode: 200,
        message: "User account deleted successfully",
      };
    } catch (err) {
      console.error("[v1/UserService/performSoftDelete] Exception:", err);
      return {
        success: false,
        statusCode: 500,
        message: "Failed to delete user account",
        error: err.message,
      };
    }
  }
}

module.exports = new UserService();

