const { supabaseAdmin } = require("../db/config");

class ProfileService {
  /**
   * Normalize gender value to match database constraint (uppercase)
   */
  normalizeGender(gender) {
    if (!gender) return null;

    const normalized = String(gender).toUpperCase().trim();
    const validGenders = ["MALE", "FEMALE", "OTHER"];

    if (validGenders.includes(normalized)) {
      return normalized;
    }

    // If lowercase provided, convert to uppercase
    const lower = normalized.toLowerCase();
    if (lower === "male") return "MALE";
    if (lower === "female") return "FEMALE";
    if (lower === "other") return "OTHER";

    return null; // Invalid gender, return null
  }

  normalizeTier(tier) {
    if (!tier) return null;
  
    const normalized = String(tier).toUpperCase().trim();
    const validTiers = ["NANO", "MICRO", "MID", "MACRO"];
  
    if (validTiers.includes(normalized)) {
      return normalized;
    }
  
    // Handle lowercase variations
    const lower = normalized.toLowerCase();
    if (lower === "nano") return "NANO";
    if (lower === "micro") return "MICRO";
    if (lower === "mid") return "MID";
    if (lower === "macro") return "MACRO";
  
    return null; // Invalid tier, return null
  }

  /**
   * Normalize platform name to match database enum (INSTAGRAM | FACEBOOK | YOUTUBE)
   */
  normalizePlatform(platformName) {
    if (!platformName) return null;

    const normalized = String(platformName).toUpperCase().trim();
    const validPlatforms = ["INSTAGRAM", "FACEBOOK", "YOUTUBE"];

    if (validPlatforms.includes(normalized)) {
      return normalized;
    }

    // Handle common variations
    const lower = normalized.toLowerCase();
    if (lower === "instagram" || lower === "ig") return "INSTAGRAM";
    if (lower === "facebook" || lower === "fb") return "FACEBOOK";
    if (lower === "youtube" || lower === "yt") return "YOUTUBE";

    return null; // Invalid platform
  }

  /**
   * Upsert social platforms for v1 influencer
   */
  async upsertSocialPlatforms(userId, platforms) {
    try {
      if (!Array.isArray(platforms) || platforms.length === 0) {
        return { success: true, count: 0 };
      }

      let successCount = 0;
      const errors = [];

      for (const platform of platforms) {
        try {
          const platformName = this.normalizePlatform(
            platform.platform_name || platform.platform
          );
          const username = platform.username || null;
          const profileUrl =
            platform.profile_url || platform.profile_link || null;
          const followerCount =
            platform.follower_count !== undefined
              ? parseInt(platform.follower_count)
              : null;
          const engagementRate =
            platform.engagement_rate !== undefined
              ? parseFloat(platform.engagement_rate)
              : null;

          if (!platformName || !username) {
            console.warn(
              "[v1/upsertSocialPlatforms] Skipping invalid platform:",
              platform
            );
            continue;
          }

          // Check if platform already exists for this user
          const { data: existing, error: checkError } = await supabaseAdmin
            .from("v1_influencer_social_accounts")
            .select("id")
            .eq("user_id", userId)
            .eq("platform", platformName)
            .eq("is_deleted", false)
            .maybeSingle();

          // Determine data_source: use from payload if provided, otherwise default to MANUAL
          // GRAPH_API should be used when connected via Facebook/Instagram Graph API
          const dataSource = platform.data_source || "MANUAL";
          const normalizedDataSource =
            dataSource.toUpperCase() === "GRAPH_API" ? "GRAPH_API" : "MANUAL";

          const platformData = {
            user_id: userId,
            platform: platformName,
            username: username,
            profile_url: profileUrl,
            follower_count: Number.isNaN(followerCount) ? null : followerCount,
            engagement_rate: Number.isNaN(engagementRate)
              ? null
              : engagementRate,
            data_source: normalizedDataSource,
            is_deleted: false,
          };

          if (existing && !checkError) {
            // Update existing
            const { error: updateError } = await supabaseAdmin
              .from("v1_influencer_social_accounts")
              .update(platformData)
              .eq("id", existing.id);

            if (updateError) {
              console.error(
                `[v1/upsertSocialPlatforms] Update error for ${platformName}:`,
                updateError
              );
              errors.push({
                platform: platformName,
                error: updateError.message,
              });
            } else {
              successCount++;
            }
          } else {
            // Insert new
            const { error: insertError } = await supabaseAdmin
              .from("v1_influencer_social_accounts")
              .insert(platformData);

            if (insertError) {
              console.error(
                `[v1/upsertSocialPlatforms] Insert error for ${platformName}:`,
                insertError
              );
              errors.push({
                platform: platformName,
                error: insertError.message,
              });
            } else {
              successCount++;
            }
          }
        } catch (err) {
          console.error(
            "[v1/upsertSocialPlatforms] Exception for platform:",
            err
          );
          errors.push({
            platform: platform?.platform_name || "unknown",
            error: err.message,
          });
        }
      }

      return {
        success: errors.length === 0,
        count: successCount,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (err) {
      console.error("[v1/upsertSocialPlatforms] Exception:", err);
      return { success: false, count: 0, error: err.message };
    }
  }

  /**
   * Complete profile - handles both INFLUENCER and BRAND_OWNER roles
   */
  async completeProfile(userId, userRole, profileData) {
    try {
      if (userRole === "INFLUENCER") {
        return await this.completeInfluencerProfile(userId, profileData);
      } else if (userRole === "BRAND_OWNER") {
        return await this.completeBrandProfile(userId, profileData);
      } else {
        return {
          success: false,
          message: "Profile completion not supported for this role",
        };
      }
    } catch (err) {
      console.error("[v1/completeProfile] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }

  /**
   * Complete influencer profile with PAN, social platforms, languages, categories
   */
  async completeInfluencerProfile(userId, profileData) {
    try {
      const {
        uploadImageToStorage,
        deleteImageFromStorage,
      } = require("../../utils/imageUpload");

      // 1) Handle profile image - file upload takes priority over direct URL
      let profileImageUrl = null;
      if (profileData.profile_image_file) {
        // File upload - upload to storage
        const { url, error: uploadError } = await uploadImageToStorage(
          profileData.profile_image_file.buffer,
          profileData.profile_image_file.originalname,
          "profiles" // Upload to profiles folder
        );

        if (uploadError || !url) {
          console.error(
            "[v1/completeInfluencerProfile] Profile image upload error:",
            uploadError
          );
          return {
            success: false,
            message: uploadError || "Failed to upload profile image",
          };
        }

        profileImageUrl = url;

        // Delete old image if exists (only if it's from our storage)
        const { data: currentProfile } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .select("profile_photo_url")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (currentProfile?.profile_photo_url) {
          // Only delete if it's from our storage (contains storage URL pattern)
          const placeholderUrl = "https://via.placeholder.com/400x400?text=Profile+Image";
          if (
            currentProfile.profile_photo_url !== placeholderUrl &&
            (currentProfile.profile_photo_url.includes('storage') ||
             currentProfile.profile_photo_url.includes('supabase') ||
             currentProfile.profile_photo_url.includes('supabase.co'))
          ) {
            await deleteImageFromStorage(currentProfile.profile_photo_url);
          }
        }
      } else if (profileData.profile_image_url !== undefined) {
        // Direct URL provided (no file upload)
        if (profileData.profile_image_url === null || profileData.profile_image_url === "") {
          profileImageUrl = null;
        } else {
          profileImageUrl = String(profileData.profile_image_url).trim();
        }

        // Optionally delete old image if it was from our storage and URL is changing
        if (profileImageUrl) {
          const { data: currentProfile } = await supabaseAdmin
            .from("v1_influencer_profiles")
            .select("profile_photo_url")
            .eq("user_id", userId)
            .eq("is_deleted", false)
            .maybeSingle();

          if (
            currentProfile?.profile_photo_url &&
            currentProfile.profile_photo_url !== profileImageUrl
          ) {
            // Only delete if it's from our storage
            const placeholderUrl = "https://via.placeholder.com/400x400?text=Profile+Image";
            if (
              currentProfile.profile_photo_url !== placeholderUrl &&
              (currentProfile.profile_photo_url.includes('storage') ||
               currentProfile.profile_photo_url.includes('supabase') ||
               currentProfile.profile_photo_url.includes('supabase.co'))
            ) {
              await deleteImageFromStorage(currentProfile.profile_photo_url);
            }
          }
        }
      }

      // 2) Update v1_influencer_profiles with all fields
      const profileUpdate = {};

      // Update profile_photo_url if provided (from file upload or direct URL)
      if (profileImageUrl !== null && profileImageUrl !== undefined) {
        profileUpdate.profile_photo_url = profileImageUrl;
      } else if (profileData.profile_image_url !== undefined && profileData.profile_image_url === null) {
        // Explicitly set to null if provided as null
        profileUpdate.profile_photo_url = null;
      }
      
      if (profileData.pan_number !== undefined) {
        profileUpdate.pan_number = profileData.pan_number || null;
      }
      
      if (profileData.primary_language !== undefined) {
        profileUpdate.primary_language = profileData.primary_language || null;
      }
      
      // Handle languages array
      if (profileData.languages !== undefined) {
        if (Array.isArray(profileData.languages)) {
          const filteredLanguages = profileData.languages
            .filter(lang => lang && String(lang).trim().length > 0)
            .map(lang => String(lang).trim());
          profileUpdate.languages = filteredLanguages.length > 0 ? filteredLanguages : null;
          // Also update primary_language if not explicitly set
          if (!profileData.primary_language && filteredLanguages.length > 0) {
            profileUpdate.primary_language = filteredLanguages[0];
          }
        } else {
          profileUpdate.languages = null;
        }
      }
      
      // Handle categories array
      if (profileData.categories !== undefined) {
        if (Array.isArray(profileData.categories)) {
          const filteredCategories = profileData.categories
            .filter(cat => cat && String(cat).trim().length > 0)
            .map(cat => String(cat).trim());
          profileUpdate.categories = filteredCategories.length > 0 ? filteredCategories : null;
        } else {
          profileUpdate.categories = null;
        }
      }
      
      // Handle bio
      if (profileData.bio !== undefined) {
        profileUpdate.bio = profileData.bio !== null && profileData.bio !== undefined
          ? String(profileData.bio).trim()
          : "";
      }
      
      // Handle city
      if (profileData.city !== undefined) {
        profileUpdate.city = profileData.city !== null && profileData.city !== undefined
          ? String(profileData.city).trim() || null
          : null;
      }
      
      // Handle country
      if (profileData.country !== undefined) {
        profileUpdate.country = profileData.country !== null && profileData.country !== undefined
          ? String(profileData.country).trim() || null
          : null;
      }
      
      // Handle gender
      if (profileData.gender !== undefined) {
        profileUpdate.gender = this.normalizeGender(profileData.gender);
      }
      
      // Handle tier
      if (profileData.tier !== undefined) {
        profileUpdate.tier = this.normalizeTier(profileData.tier);
      }
      
      // Handle min_value with proper null/NaN checking
      if (profileData.min_value !== undefined) {
        if (profileData.min_value === null || profileData.min_value === undefined || profileData.min_value === "") {
          profileUpdate.min_value = null;
        } else {
          const parsed = parseFloat(profileData.min_value);
          profileUpdate.min_value = !isNaN(parsed) ? parsed : null;
        }
      }
      
      // Handle max_value with proper null/NaN checking
      if (profileData.max_value !== undefined) {
        if (profileData.max_value === null || profileData.max_value === undefined || profileData.max_value === "") {
          profileUpdate.max_value = null;
        } else {
          const parsed = parseFloat(profileData.max_value);
          profileUpdate.max_value = !isNaN(parsed) ? parsed : null;
        }
      }

      // Validate min_value < max_value if both are provided and non-null
      if (profileUpdate.min_value !== null && profileUpdate.max_value !== null) {
        if (profileUpdate.min_value >= profileUpdate.max_value) {
          return {
            success: false,
            message: "min_value must be less than max_value",
          };
        }
      }
  
      let updatedProfile = null;
      if (Object.keys(profileUpdate).length > 0) {
        const { data, error: updateError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .update(profileUpdate)
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .select()
          .single();
  
        if (updateError) {
          console.error(
            "[v1/completeInfluencerProfile] Profile update error:",
            updateError
          );
          return { success: false, message: "Failed to update profile" };
        }
  
        updatedProfile = data;
      } else {
        // Fetch existing profile if no updates
        const { data, error: fetchError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .select("*")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .single();
  
        if (fetchError) {
          console.error(
            "[v1/completeInfluencerProfile] Profile fetch error:",
            fetchError
          );
          return { success: false, message: "Profile not found" };
        }
  
        updatedProfile = data;
      }
  
      // 2) Upsert social platforms (still in separate table)
      let socialPlatformsResult = { success: true, count: 0 };
      if (
        profileData.social_platforms &&
        Array.isArray(profileData.social_platforms)
      ) {
        socialPlatformsResult = await this.upsertSocialPlatforms(
          userId,
          profileData.social_platforms
        );
        if (!socialPlatformsResult.success) {
          console.warn(
            "[v1/completeInfluencerProfile] Some social platforms failed:",
            socialPlatformsResult.errors
          );
          // Continue - don't fail entire request
        }
      }
  
      // 3) Calculate profile completion percentage
      // Now using categories and languages from main table
      const completionPct = this.calculateProfileCompletion(updatedProfile, {
        hasSocialPlatforms: socialPlatformsResult.count > 0,
      });
  
      // Update completion percentage
      if (completionPct !== updatedProfile.profile_completion_pct) {
        await supabaseAdmin
          .from("v1_influencer_profiles")
          .update({ profile_completion_pct: completionPct })
          .eq("user_id", userId);
        updatedProfile.profile_completion_pct = completionPct;
      }
  
      return {
        success: true,
        profile: updatedProfile,
        social_platforms_count: socialPlatformsResult.count,
        categories_count: updatedProfile.categories?.length || 0,
        languages_count: updatedProfile.languages?.length || 0,
        profile_completion_pct: completionPct,
        profile_image_url: profileImageUrl || updatedProfile?.profile_photo_url,
        message: "Profile completed successfully",
      };
    } catch (err) {
      console.error("[v1/completeInfluencerProfile] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }
  

  /**
   * Complete brand profile with PAN, brand_name, bio, brand_logo
   */
  async completeBrandProfile(userId, profileData) {
    try {
      const {
        uploadImageToStorage,
        deleteImageFromStorage,
      } = require("../../utils/imageUpload");

      // 1) Handle brand logo - file upload takes priority over direct URL
      let brandLogoUrl = null;
      if (profileData.brand_logo_file) {
        // File upload - upload to storage
        const { url, error: uploadError } = await uploadImageToStorage(
          profileData.brand_logo_file.buffer,
          profileData.brand_logo_file.originalname,
          "brands" // Upload to brands folder
        );

        if (uploadError || !url) {
          console.error(
            "[v1/completeBrandProfile] Logo upload error:",
            uploadError
          );
          return {
            success: false,
            message: uploadError || "Failed to upload brand logo",
          };
        }

        brandLogoUrl = url;

        // Delete old logo if exists (only if it's from our storage)
        const { data: currentProfile } = await supabaseAdmin
          .from("v1_brand_profiles")
          .select("brand_logo_url")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (currentProfile?.brand_logo_url) {
          // Only delete if it's from our storage (contains storage URL pattern)
          const placeholderUrl = "https://via.placeholder.com/400x400?text=Brand+Logo";
          if (
            currentProfile.brand_logo_url !== placeholderUrl &&
            (currentProfile.brand_logo_url.includes('storage') ||
             currentProfile.brand_logo_url.includes('supabase') ||
             currentProfile.brand_logo_url.includes('supabase.co'))
          ) {
            await deleteImageFromStorage(currentProfile.brand_logo_url);
          }
        }
      } else if (profileData.brand_logo_url !== undefined) {
        // Direct URL provided (no file upload)
        if (profileData.brand_logo_url === null || profileData.brand_logo_url === "") {
          brandLogoUrl = null;
        } else {
          brandLogoUrl = String(profileData.brand_logo_url).trim();
        }

        // Optionally delete old logo if it was from our storage and URL is changing
        if (brandLogoUrl) {
          const { data: currentProfile } = await supabaseAdmin
            .from("v1_brand_profiles")
            .select("brand_logo_url")
            .eq("user_id", userId)
            .eq("is_deleted", false)
            .maybeSingle();

          if (
            currentProfile?.brand_logo_url &&
            currentProfile.brand_logo_url !== brandLogoUrl
          ) {
            // Only delete if it's from our storage
            const placeholderUrl = "https://via.placeholder.com/400x400?text=Brand+Logo";
            if (
              currentProfile.brand_logo_url !== placeholderUrl &&
              (currentProfile.brand_logo_url.includes('storage') ||
               currentProfile.brand_logo_url.includes('supabase') ||
               currentProfile.brand_logo_url.includes('supabase.co'))
            ) {
              await deleteImageFromStorage(currentProfile.brand_logo_url);
            }
          }
        }
      }

      // 2) Update v1_brand_profiles
      const profileUpdate = {};

      // Debug logging (exclude file buffer to avoid terminal spam)
      const loggableProfileData = { ...profileData };
      if (loggableProfileData.brand_logo_file) {
        loggableProfileData.brand_logo_file = {
          originalname: profileData.brand_logo_file.originalname,
          size: profileData.brand_logo_file.size,
          mimetype: profileData.brand_logo_file.mimetype,
          // Don't log buffer data
        };
      }

      console.log(
        "[v1/completeBrandProfile] Received profileData:",
        JSON.stringify(loggableProfileData, null, 2)
      );

      // Update pan_number if provided
      if (profileData.pan_number !== undefined) {
        // Explicitly check for null/undefined, preserve empty strings
        if (
          profileData.pan_number === null ||
          profileData.pan_number === undefined
        ) {
          profileUpdate.pan_number = null;
        } else {
          const trimmed = String(profileData.pan_number).trim();
          profileUpdate.pan_number = trimmed || null;
        }
        console.log(
          "[v1/completeBrandProfile] Setting pan_number:",
          profileUpdate.pan_number
        );
      }

      // Update brand_name if provided
      if (profileData.brand_name !== undefined) {
        // Explicitly check for null/undefined, preserve empty strings
        if (
          profileData.brand_name === null ||
          profileData.brand_name === undefined
        ) {
          profileUpdate.brand_name = null;
        } else {
          const trimmed = String(profileData.brand_name).trim();
          profileUpdate.brand_name = trimmed || null;
        }
        console.log(
          "[v1/completeBrandProfile] Setting brand_name:",
          profileUpdate.brand_name
        );
      }

       // Update bio if provided
       if (profileData.bio !== undefined) {
        // Explicitly check for null/undefined, preserve empty strings
        if (profileData.bio === null || profileData.bio === undefined) {
          profileUpdate.bio = null;
        } else {
          const trimmed = String(profileData.bio).trim();
          profileUpdate.bio = trimmed || null;
        }
        console.log(
          "[v1/completeBrandProfile] Setting bio:",
          profileUpdate.bio
        );
      }

      // Update brand_description if provided
      if (profileData.brand_description !== undefined) {
        if (profileData.brand_description === null || profileData.brand_description === undefined) {
          profileUpdate.brand_description = null;
        } else {
          const trimmed = String(profileData.brand_description).trim();
          profileUpdate.brand_description = trimmed || null;
        }
        console.log(
          "[v1/completeBrandProfile] Setting brand_description:",
          profileUpdate.brand_description
        );
      }

      // Update gender if provided
      if (profileData.gender !== undefined) {
        profileUpdate.gender = this.normalizeGender(profileData.gender);
        console.log(
          "[v1/completeBrandProfile] Setting gender:",
          profileUpdate.gender
        );
      }

      // Update brand_logo_url if provided (from file upload or direct URL)
      if (brandLogoUrl !== null) {
        profileUpdate.brand_logo_url = brandLogoUrl;
      } else if (profileData.brand_logo_url !== undefined && profileData.brand_logo_url === null) {
        // Explicitly set to null if provided as null
        profileUpdate.brand_logo_url = null;
      }

      console.log(
        "[v1/completeBrandProfile] Final profileUpdate:",
        JSON.stringify(profileUpdate, null, 2)
      );

      // Check if profile exists
      const { data: existingProfile, error: fetchError } = await supabaseAdmin
        .from("v1_brand_profiles")
        .select("*")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      let updatedProfile = null;

      if (!existingProfile) {
        // Profile doesn't exist - create it
        console.log(
          "[v1/completeBrandProfile] Profile not found, creating new profile"
        );

        const placeholderLogoUrl =
          "https://via.placeholder.com/400x400?text=Brand+Logo";

        const newProfile = {
          user_id: userId,
          brand_name: profileData.brand_name || "", // Required field
          brand_logo_url: brandLogoUrl || placeholderLogoUrl, // Required field
          bio: profileData.bio || null,
          brand_description: profileData.brand_description || null, // Add brand_description
          gender: this.normalizeGender(profileData.gender) || null, // Add gender
          pan_number: profileData.pan_number || null,
          pan_verified: false,
          profile_completion_pct: 0,
          is_deleted: false,
        };

        const { data: createdProfile, error: createError } = await supabaseAdmin
          .from("v1_brand_profiles")
          .insert(newProfile)
          .select()
          .single();

        if (createError) {
          console.error(
            "[v1/completeBrandProfile] Profile creation error:",
            createError
          );
          // If logo was uploaded but profile creation failed, try to delete uploaded logo
          if (brandLogoUrl) {
            await deleteImageFromStorage(brandLogoUrl);
          }
          return {
            success: false,
            message: "Failed to create profile",
            error: createError.message,
          };
        }

        updatedProfile = createdProfile;
      } else {
        // Profile exists - update it
        if (Object.keys(profileUpdate).length > 0) {
          const { data, error: updateError } = await supabaseAdmin
            .from("v1_brand_profiles")
            .update(profileUpdate)
            .eq("user_id", userId)
            .eq("is_deleted", false)
            .select()
            .single();

          if (updateError) {
            console.error(
              "[v1/completeBrandProfile] Profile update error:",
              updateError
            );
            // If logo was uploaded but update failed, try to delete uploaded logo
            if (brandLogoUrl) {
              await deleteImageFromStorage(brandLogoUrl);
            }
            return { success: false, message: "Failed to update profile" };
          }

          updatedProfile = data;
        } else {
          // No updates to make, use existing profile
          updatedProfile = existingProfile;
        }
      }

      // 3) Calculate profile completion percentage for brand
      const completionPct =
        this.calculateBrandProfileCompletion(updatedProfile);

      // Update completion percentage
      if (completionPct !== updatedProfile.profile_completion_pct) {
        await supabaseAdmin
          .from("v1_brand_profiles")
          .update({ profile_completion_pct: completionPct })
          .eq("user_id", userId);
        updatedProfile.profile_completion_pct = completionPct;
      }

      return {
        success: true,
        profile: updatedProfile,
        profile_completion_pct: completionPct,
        brand_logo_url: brandLogoUrl || updatedProfile.brand_logo_url,
        message: "Profile completed successfully",
      };
    } catch (err) {
      console.error("[v1/completeBrandProfile] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }

  /**
   * Calculate brand profile completion percentage
   */
  calculateBrandProfileCompletion(profile) {
    let completed = 0;
    let total = 0;
  
    // Required/important fields
    total++;
    if (profile.brand_logo_url) completed++;
  
    total++;
    if (profile.brand_name) completed++;
  
    total++;
    if (profile.bio) completed++;
  
    total++;
    if (profile.brand_description) completed++; // Add brand_description
  
    total++;
    if (profile.pan_number) completed++;
  
    return Math.round((completed / total) * 100);
  }

  /**
   * Calculate influencer profile completion percentage
   */
  calculateProfileCompletion(profile, extras = {}) {
    let completed = 0;
    let total = 0;
  
    // Required fields
    total++;
    if (profile.profile_photo_url) completed++;
  
    total++;
    if (profile.bio && profile.bio.trim().length > 0) completed++;
  
    // Optional but important
    total++;
    if (profile.pan_number) completed++;
  
    total++;
    if (profile.primary_language || (profile.languages && profile.languages.length > 0)) completed++;
  
    total++;
    if (extras.hasSocialPlatforms) completed++;
  
    // Check categories from main table array
    total++;
    if (profile.categories && Array.isArray(profile.categories) && profile.categories.length > 0) completed++;
  
    return Math.round((completed / total) * 100);
  }

  // ---------- Profile Image Upload ----------

  async uploadProfileImage(userId, fileBuffer, fileName) {
    try {
      const {
        uploadImageToStorage,
        deleteImageFromStorage,
      } = require("../../utils/imageUpload");

      // 1) Get user to check role
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role")
        .eq("id", userId)
        .eq("is_deleted", false)
        .single();

      if (userError || !user) {
        console.error("[v1/uploadProfileImage] User not found:", userError);
        return { success: false, message: "User not found" };
      }

      // 2) Upload new profile image first
      const { url, error: uploadError } = await uploadImageToStorage(
        fileBuffer,
        fileName,
        "profiles"
      );

      if (uploadError || !url) {
        console.error("[v1/uploadProfileImage] Upload error:", uploadError);
        return {
          success: false,
          message: uploadError || "Failed to upload image",
        };
      }

      // 3) Check if profile exists
      const { data: currentProfile, error: fetchError } = await supabaseAdmin
        .from("v1_influencer_profiles")
        .select("profile_photo_url")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (fetchError && fetchError.code !== "PGRST116") {
        console.error(
          "[v1/uploadProfileImage] Error fetching profile:",
          fetchError
        );
        return { success: false, message: "Failed to fetch profile" };
      }

      // 4) Delete old profile image if it exists
      if (currentProfile?.profile_photo_url) {
        await deleteImageFromStorage(currentProfile.profile_photo_url);
      }

      // 5) Create or update profile
      let updatedProfile;

      if (!currentProfile) {
        // Profile doesn't exist - create it with the image URL
        // This should rarely happen now since profile is created during verify-otp
        console.log(
          "[v1/uploadProfileImage] Profile not found, creating new profile"
        );

        if (user.role === "INFLUENCER") {
          const profileData = {
            user_id: userId,
            profile_photo_url: url,
            is_profile_verified: false,
            bio: "",
            city: null,
            country: null,
            primary_language: null,
            languages: null,
            gender: null,
            tier: null,
            pan_number: null,
            pan_verified: false,
            profile_completion_pct: 0,
            is_deleted: false,
            categories: null,
            min_value: null,
            max_value: null,
          };
      
          const { data: createdProfile, error: createError } =
            await supabaseAdmin
              .from("v1_influencer_profiles")
              .insert(profileData)
              .select()
              .single();
      
          if (createError) {
            console.error(
              "[v1/uploadProfileImage] Profile creation error:",
              createError
            );
            await deleteImageFromStorage(url);
            return {
              success: false,
              message: "Failed to create profile",
              error: createError.message,
            };
          }
      
          updatedProfile = createdProfile;
        } else {
          // For BRAND_OWNER or other roles, handle differently if needed
          return {
            success: false,
            message: "Profile image upload only supported for influencers",
          };
        }
      } else {
        // Profile exists - update it with new image URL
        // Delete old image if it's not the placeholder
        const placeholderUrl =
          "https://via.placeholder.com/400x400?text=Profile+Image";
        if (
          currentProfile.profile_photo_url &&
          currentProfile.profile_photo_url !== placeholderUrl
        ) {
          await deleteImageFromStorage(currentProfile.profile_photo_url);
        }

        const { data: updated, error: updateError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .update({ profile_photo_url: url })
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .select()
          .single();

        if (updateError) {
          console.error("[v1/uploadProfileImage] Update error:", updateError);
          // Try to delete uploaded image if update fails
          await deleteImageFromStorage(url);
          return {
            success: false,
            message: "Failed to update profile image",
            error: updateError.message,
          };
        }

        updatedProfile = updated;
      }

      return {
        success: true,
        profile: updatedProfile,
        profile_image_url: url,
        message: "Profile image uploaded successfully",
      };
    } catch (err) {
      console.error("[v1/uploadProfileImage] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }
}

module.exports = new ProfileService();

