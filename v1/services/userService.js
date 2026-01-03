const { supabaseAdmin } = require("../db/config");

/**
 * User Service
 * Handles business logic for user data retrieval
 */
class UserService {
  /**
   * Get user details with all related data
   * Returns different data based on user role (BRAND or INFLUENCER)
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
      if (user.role === "BRAND") {
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

      // Get campaigns created by this brand
      const { data: campaigns, error: campaignsError } = await supabaseAdmin
        .from("v1_campaigns")
        .select("*")
        .eq("brand_id", user.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (campaignsError) {
        console.error(
          "[v1/UserService/getBrandUserData] Campaigns error:",
          campaignsError
        );
      }

      // Get applications for this brand's campaigns
      const { data: applications, error: applicationsError } =
        await supabaseAdmin
          .from("v1_applications")
          .select(`
            *,
            v1_campaigns(
              id,
              title,
              brand_id,
              cover_image_url,
              status
            )
          `)
          .eq("brand_id", user.id)
          .order("created_at", { ascending: false });

      if (applicationsError) {
        console.error(
          "[v1/UserService/getBrandUserData] Applications error:",
          applicationsError
        );
      }

      return {
        success: true,
        user: user,
        brand_profile: brandProfile || null,
        campaigns: campaigns || [],
        applications: applications || [],
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

      // Get applications made by this influencer
      const { data: applications, error: applicationsError } =
        await supabaseAdmin
          .from("v1_applications")
          .select(`
            *,
            v1_campaigns(
              id,
              title,
              brand_id,
              cover_image_url,
              status
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

      return {
        success: true,
        user: user,
        influencer_profile: influencerProfile || null,
        social_accounts: socialAccounts || [],
        applications: applications || [],
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
}

module.exports = new UserService();

