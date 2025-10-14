const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult } = require("express-validator");

class SocialPlatformController {
  /**
   * Get user's social media platforms
   */
  async getSocialPlatforms(req, res) {
    try {
      const userId = req.user.id;
      console.log(userId)

      const { data: platforms, error } = await supabaseAdmin
        .from("social_platforms")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch social platforms",
        });
      }

      res.json({
        success: true,
        platforms: platforms || [],
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Add a new social media platform
   */
  async addSocialPlatform(req, res) {
    try {
      console.log('🔍 [SOCIAL PLATFORM DEBUG] addSocialPlatform called');
      console.log('🔍 [SOCIAL PLATFORM DEBUG] Request body:', req.body);
      console.log('🔍 [SOCIAL PLATFORM DEBUG] User ID:', req.user.id);

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('🔍 [SOCIAL PLATFORM DEBUG] Validation errors:', errors.array());
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { 
        platform, 
        username,
        profile_link, 
        followers_count,
      } = req.body;

      console.log('🔍 [SOCIAL PLATFORM DEBUG] Extracted data:', {
        platform,
        username,
        profile_link,
        followers_count
      });

      // Check if platform already exists for this user
      const { data: existingPlatform, error: checkError } = await supabaseAdmin
        .from("social_platforms")
        .select("id")
        .eq("user_id", userId)
        .eq("platform_name", platform)
        .single();

      if (existingPlatform) {
        console.log('🔍 [SOCIAL PLATFORM DEBUG] Platform already exists for user');
        return res.status(400).json({
          success: false,
          message: "Platform already exists for this user",
        });
      }

      console.log('🔍 [SOCIAL PLATFORM DEBUG] Inserting platform data...');
      const { data: platformData, error } = await supabaseAdmin
        .from("social_platforms")
        .insert({
          user_id: userId,
          platform_name: platform,  // Map frontend 'platform' to database 'platform_name'
          username: username,        // Add username field for the constraint
          profile_link: profile_link || `https://${platform}.com/${username}`, // Generate profile link if not provided
          followers_count: parseInt(followers_count)
        })
        .select()
        .single();

      console.log('🔍 [SOCIAL PLATFORM DEBUG] Insert result:', { platformData, error });

      if (error) {
        console.error('Social platform insert error:', error);
        return res.status(500).json({
          success: false,
          message: "Failed to add social platform",
          error: error.message
        });
      }

      res.status(201).json({
        success: true,
        platform: platformData,
        message: "Social platform added successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Update a social media platform
   */
  async updateSocialPlatform(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { id } = req.params;
      const { platform_name, profile_link, followers_count, engagement_rate } =
        req.body;

      // Check if platform belongs to user
      const { data: existingPlatform, error: checkError } = await supabaseAdmin
        .from("social_platforms")
        .select("id")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

      if (!existingPlatform) {
        return res.status(404).json({
          success: false,
          message: "Social platform not found",
        });
      }

      // Check if new platform name conflicts with existing platforms
      if (platform_name) {
        const { data: conflictPlatform, error: conflictError } =
          await supabaseAdmin
            .from("social_platforms")
            .select("id")
            .eq("user_id", userId)
            .eq("platform_name", platform_name)
            .neq("id", id)
            .single();

        if (conflictPlatform) {
          return res.status(400).json({
            success: false,
            message: "Platform name already exists for this user",
          });
        }
      }

      const updateData = {};
      if (platform_name) updateData.platform_name = platform_name;
      if (profile_link !== undefined) updateData.profile_link = profile_link;
      if (followers_count !== undefined)
        updateData.followers_count = followers_count
          ? parseInt(followers_count)
          : null;
      if (engagement_rate !== undefined)
        updateData.engagement_rate = engagement_rate
          ? parseFloat(engagement_rate)
          : null;

      const { data: platform, error } = await supabaseAdmin
        .from("social_platforms")
        .update(updateData)
        .eq("id", id)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to update social platform",
        });
      }

      res.json({
        success: true,
        platform: platform,
        message: "Social platform updated successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete a social media platform
   */
  async deleteSocialPlatform(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      // Check if platform belongs to user
      const { data: existingPlatform, error: checkError } = await supabaseAdmin
        .from("social_platforms")
        .select("id")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

      if (!existingPlatform) {
        return res.status(404).json({
          success: false,
          message: "Social platform not found",
        });
      }

      const { error } = await supabaseAdmin
        .from("social_platforms")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to delete social platform",
        });
      }

      res.json({
        success: true,
        message: "Social platform deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get social platform statistics for a user
   */
  async getSocialPlatformStats(req, res) {
    try {
      const userId = req.user.id;

      const { data: platforms, error } = await supabaseAdmin
        .from("social_platforms")
        .select("platform_name, followers_count, engagement_rate")
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch social platform statistics",
        });
      }

      const stats = {
        total_platforms: platforms.length,
        total_followers: platforms.reduce(
          (sum, p) => sum + (p.followers_count || 0),
          0
        ),
        average_engagement:
          platforms.length > 0
            ? platforms.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) /
              platforms.length
            : 0,
        platforms: platforms.map((p) => ({
          platform_name: p.platform_name,
          followers_count: p.followers_count,
          engagement_rate: p.engagement_rate,
        })),
      };

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
}

// Validation middleware - Match frontend field names
const validateSocialPlatform = [
  body("platform")
    .notEmpty()
    .withMessage("Platform is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("Platform must be between 2 and 50 characters"),
  body("username")
    .notEmpty()
    .withMessage("Username is required")
    .isLength({ min: 1, max: 100 })
    .withMessage("Username must be between 1 and 100 characters"),
  body("profile_link")
    .optional()
    .isURL()
    .withMessage("Profile link must be a valid URL"),
  body("followers_count")
    .notEmpty()
    .withMessage("Followers count is required")
    .isInt({ min: 0 })
    .withMessage("Followers count must be a non-negative integer"),
];

const validateSocialPlatformUpdate = [
  body("platform_name")
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage("Platform name must be between 2 and 50 characters"),
  body("profile_link")
    .optional()
    .isURL()
    .withMessage("Profile link must be a valid URL"),
  body("followers_count")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Followers count must be a non-negative integer"),
  body("engagement_rate")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("Engagement rate must be between 0 and 100"),
];

module.exports = {
  SocialPlatformController: new SocialPlatformController(),
  validateSocialPlatform,
  validateSocialPlatformUpdate,
};
