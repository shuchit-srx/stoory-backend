const { validationResult } = require("express-validator");
const { ProfileService } = require("../services");

class ProfileController {
  async completeProfile(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const userRole = req.user.role;

      // Handle both JSON and multipart/form-data
      let bodyData = req.body;

      // If multipart, handle file uploads
      if (req.files) {
        // Handle profile image for influencers
        if (req.files.profileImage && req.files.profileImage[0]) {
          bodyData.profile_image_file = req.files.profileImage[0];
        }
        // Handle brand logo for brands (backward compatible with brand_logo)
        if (req.files.brandLogo && req.files.brandLogo[0]) {
          bodyData.brand_logo_file = req.files.brandLogo[0];
        }
      }
      // Backward compatibility: also check req.file (for single file uploads)
      if (req.file && !bodyData.brand_logo_file && !bodyData.profile_image_file) {
        // Assume it's brand_logo for backward compatibility
        bodyData.brand_logo_file = req.file;
      }

      // Parse JSON strings if they exist (multer sends JSON as strings)
      if (typeof bodyData.social_platforms === "string") {
        try {
          bodyData.social_platforms = JSON.parse(bodyData.social_platforms);
        } catch (e) {
          // Ignore parse errors
        }
      }
      if (typeof bodyData.languages === "string") {
        try {
          bodyData.languages = JSON.parse(bodyData.languages);
        } catch (e) {
          // Ignore parse errors
        }
      }
      if (typeof bodyData.categories === "string") {
        try {
          bodyData.categories = JSON.parse(bodyData.categories);
        } catch (e) {
          // Ignore parse errors
        }
      }
      // Add parsing for brand_description if it comes as string in multipart
      if (typeof bodyData.brand_description === "string") {
        try {
          // Try to parse as JSON first (in case it's a JSON string)
          const parsed = JSON.parse(bodyData.brand_description);
          // Only use parsed value if it's a string (not an object)
          if (typeof parsed === "string") {
            bodyData.brand_description = parsed;
          }
          // If parsed to non-string, keep original (shouldn't happen but safe)
        } catch (e) {
          // If not JSON, keep as string (it's already a string)
        }
      }

      const {
        pan_number,
        upi_id,
        social_platforms,
        languages,
        categories,
        // Additional influencer fields
        bio,
        city,
        country,
        gender,
        tier,
        min_value,
        max_value,
        // Brand-specific fields
        brand_name,
        brand_description,
        brand_logo_url,
        brand_logo_file,
        profile_image_file,
        profile_image_url,
      } = bodyData;

      // Debug logging
      console.log("[v1/completeProfile] Controller received bodyData:", {
        pan_number,
        brand_name,
        bio,
        userRole,
        hasFile: !!brand_logo_file,
      });

      // Prepare profile data based on role
      const profileData = {
        pan_number: pan_number !== undefined ? pan_number : undefined,
        upi_id: upi_id !== undefined ? upi_id : undefined,
      };

      if (userRole === "INFLUENCER") {
        // Handle profile image file upload
        if (profile_image_file) {
          profileData.profile_image_file = profile_image_file;
        }
        // Add support for direct profile_image_url (file upload takes priority)
        if (profile_image_url !== undefined && !profile_image_file) {
          profileData.profile_image_url = profile_image_url;
        }

        // Influencer-specific fields
        if (languages && Array.isArray(languages) && languages.length > 0) {
          profileData.primary_language = languages[0];
          profileData.languages = languages; // Pass full array
        } else if (languages !== undefined) {
          profileData.languages = languages; // Allow empty array
        }
        
        if (social_platforms !== undefined) {
          profileData.social_platforms = social_platforms;
        }
        
        if (categories !== undefined) {
          profileData.categories = categories; // Pass array directly
        }
        
        // Additional fields
        if (bio !== undefined) {
          profileData.bio = bio;
        }
        if (city !== undefined) {
          profileData.city = city;
        }
        if (country !== undefined) {
          profileData.country = country;
        }
        if (gender !== undefined) {
          profileData.gender = gender;
        }
        if (tier !== undefined) {
          profileData.tier = tier;
        }
        if (min_value !== undefined) {
          profileData.min_value = min_value;
        }
        if (max_value !== undefined) {
          profileData.max_value = max_value;
        }
      } else if (userRole === "BRAND_OWNER") {
        // Brand-specific fields
        if (brand_name !== undefined) {
          profileData.brand_name = brand_name;
        }
        if (bio !== undefined) {
          profileData.bio = bio;
        }
        if (brand_description !== undefined) {
          profileData.brand_description = brand_description;
        }
        if (gender !== undefined) {
          profileData.gender = gender;
        }
        if (brand_logo_file) {
          profileData.brand_logo_file = brand_logo_file;
        }
        // Add support for direct brand_logo_url (file upload takes priority)
        if (brand_logo_url !== undefined && !brand_logo_file) {
          profileData.brand_logo_url = brand_logo_url;
        }
      }

      // Debug: Log what we're sending to service
      console.log("[v1/completeProfile] Sending to service:", {
        pan_number: profileData.pan_number,
        brand_name: profileData.brand_name,
        bio: profileData.bio,
        hasLogoFile: !!profileData.brand_logo_file,
      });

      const result = await ProfileService.completeProfile(
        userId,
        userRole,
        profileData
      );

      if (result.success) {
        const response = {
          success: true,
          profile: result.profile,
          profile_completion_pct: result.profile_completion_pct,
          message: result.message,
        };

        // Add role-specific response fields
        if (userRole === "INFLUENCER") {
          response.social_platforms_count = result.social_platforms_count;
          response.categories_count = result.categories_count;
          if (result.profile_image_url) {
            response.profile_image_url = result.profile_image_url;
          }
        } else if (userRole === "BRAND_OWNER") {
          if (result.brand_logo_url) {
            response.brand_logo_url = result.brand_logo_url;
          }
        }

        return res.json(response);
      }

      return res.status(400).json({
        success: false,
        message: result.message,
      });
    } catch (err) {
      console.error("[v1/completeProfile] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
}

module.exports = {
  ProfileController: new ProfileController(),
};

