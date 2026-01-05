const { supabaseAdmin } = require("../db/config");
const { uploadImageToStorage, deleteImageFromStorage } = require("../utils/imageUpload");

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
   * Normalize platform name to match database constraint (INSTAGRAM | FACEBOOK | YOUTUBE)
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
   * Upsert social platforms for influencer
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
            platform.platform_name || platform.platform || platform.platformName
          );
          const username = platform.username || null;
          const profileUrl =
            platform.profile_url || platform.profile_link || platform.profileUrl || null;
          const followerCount =
            platform.follower_count !== undefined
              ? parseInt(platform.follower_count)
              : null;
          const engagementRate =
            platform.engagement_rate !== undefined
              ? parseFloat(platform.engagement_rate)
              : null;
          const dataSource = platform.data_source || "MANUAL";
          const normalizedDataSource =
            dataSource.toUpperCase() === "GRAPH_API" ? "GRAPH_API" : "MANUAL";

          if (!platformName || !username || !profileUrl) {
            console.warn(
              "[v1/upsertSocialPlatforms] Skipping invalid platform:",
              platform
            );
            errors.push({
              platform: platformName || "unknown",
              error: "Platform name, username, and profile_url are required",
            });
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
            platform: platform?.platform_name || platform?.platform || "unknown",
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
   * Update influencer profile
   * Accepts all user-editable fields from v1_users and v1_influencer_profiles
   * Handles image uploads for profile_photo_url
   */
  async updateInfluencerProfile(userId, profileData) {
    try {
      // 1) Handle profile image - file upload takes priority over direct URL
      let profileImageUrl = null;
      if (profileData.profile_image_file) {
        // File upload - upload to storage
        const { url, error: uploadError } = await uploadImageToStorage(
          profileData.profile_image_file.buffer,
          profileData.profile_image_file.originalname,
          "profiles"
        );

        if (uploadError || !url) {
          console.error(
            "[v1/updateInfluencerProfile] Profile image upload error:",
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
      }

      // 2) Update v1_users table (editable fields: name, email, phone_number)
      const userUpdate = {};
      if (profileData.name !== undefined) {
        const nameValue = profileData.name !== null && profileData.name !== undefined
          ? String(profileData.name).trim()
          : null;
        // Name is required (NOT NULL) in schema, so validate it's not empty
        if (!nameValue || nameValue.length === 0) {
          return { success: false, message: "Name is required and cannot be empty" };
        }
        userUpdate.name = nameValue;
      }
      if (profileData.email !== undefined) {
        const emailValue = profileData.email !== null && profileData.email !== undefined
          ? String(profileData.email).trim() || null
          : null;
        // Email is required (NOT NULL) in schema, so validate it's not empty
        if (!emailValue || emailValue.length === 0) {
          return { success: false, message: "Email is required and cannot be empty" };
        }
        // Validate email format if provided
        if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
          return { success: false, message: "Invalid email format" };
        }
        userUpdate.email = emailValue;
      }
      if (profileData.phone_number !== undefined) {
        userUpdate.phone_number = profileData.phone_number !== null && profileData.phone_number !== undefined
          ? String(profileData.phone_number).trim() || null
          : null;
      }

      if (Object.keys(userUpdate).length > 0) {
        // First check if user exists
        const { data: existingUser, error: checkError } = await supabaseAdmin
          .from("v1_users")
          .select("id")
          .eq("id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (checkError) {
          console.error(
            "[v1/updateInfluencerProfile] User check error:",
            checkError
          );
          return { success: false, message: "Failed to verify user" };
        }

        if (!existingUser) {
          return { success: false, message: "User not found or deleted" };
        }

        const { error: userUpdateError } = await supabaseAdmin
          .from("v1_users")
          .update(userUpdate)
          .eq("id", userId)
          .eq("is_deleted", false);

        if (userUpdateError) {
          console.error(
            "[v1/updateInfluencerProfile] User update error:",
            userUpdateError
          );
          // If image was uploaded but user update failed, delete the uploaded image
          if (profileImageUrl) {
            await deleteImageFromStorage(profileImageUrl);
          }
          
          // Return more specific error message
          let errorMessage = "Failed to update user data";
          if (userUpdateError.code === "23505") {
            errorMessage = "Email already exists";
          } else if (userUpdateError.message) {
            errorMessage = userUpdateError.message;
          }
          
          return { success: false, message: errorMessage };
        }
      }

      // 3) Update v1_influencer_profiles table
      const profileUpdate = {};

      // Update profile_photo_url if provided
      if (profileImageUrl !== null && profileImageUrl !== undefined) {
        profileUpdate.profile_photo_url = profileImageUrl;
      } else if (profileData.profile_image_url !== undefined && profileData.profile_image_url === null) {
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

      // Handle min_value
      if (profileData.min_value !== undefined) {
        if (profileData.min_value === null || profileData.min_value === undefined || profileData.min_value === "") {
          profileUpdate.min_value = null;
        } else {
          const parsed = parseFloat(profileData.min_value);
          profileUpdate.min_value = !isNaN(parsed) ? parsed : null;
        }
      }

      // Handle max_value
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
            "[v1/updateInfluencerProfile] Profile update error:",
            updateError
          );
          // If image was uploaded but profile update failed, delete the uploaded image
          if (profileImageUrl) {
            await deleteImageFromStorage(profileImageUrl);
          }
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
            "[v1/updateInfluencerProfile] Profile fetch error:",
            fetchError
          );
          return { success: false, message: "Profile not found" };
        }

        updatedProfile = data;
      }

      // 4) Upsert social platforms if provided
      let socialPlatformsResult = { success: true, count: 0 };
      if (profileData.social_platforms !== undefined) {
        if (Array.isArray(profileData.social_platforms) && profileData.social_platforms.length > 0) {
          socialPlatformsResult = await this.upsertSocialPlatforms(
            userId,
            profileData.social_platforms
          );
          if (!socialPlatformsResult.success) {
            console.warn(
              "[v1/updateInfluencerProfile] Some social platforms failed:",
              socialPlatformsResult.errors
            );
            // Continue - don't fail entire request, but log warning
          }
        } else if (profileData.social_platforms === null || 
                   (Array.isArray(profileData.social_platforms) && profileData.social_platforms.length === 0)) {
          // If empty array or null, we could optionally delete all platforms
          // For now, we'll just skip updating them
          socialPlatformsResult = { success: true, count: 0 };
        }
      }

      // 5) Fetch all user data
      const { data: userData, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("id", userId)
        .eq("is_deleted", false)
        .single();

      if (userError) {
        console.error(
          "[v1/updateInfluencerProfile] Error fetching user data:",
          userError
        );
      }

      // Filter out sensitive/unnecessary fields from user data
      let filteredUserData = null;
      if (userData) {
        const { is_deleted, password_hash, password_reset_token, password_reset_token_expires_at, ...rest } = userData;
        filteredUserData = rest;
      }

      // 6) Fetch all social accounts
      const { data: socialAccounts, error: socialAccountsError } = await supabaseAdmin
        .from("v1_influencer_social_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (socialAccountsError) {
        console.error(
          "[v1/updateInfluencerProfile] Error fetching social accounts:",
          socialAccountsError
        );
      }

      return {
        success: true,
        user: filteredUserData,
        profile: updatedProfile,
        social_accounts: socialAccounts || [],
        social_platforms_errors: socialPlatformsResult.errors,
        message: "Profile updated successfully",
      };
    } catch (err) {
      console.error("[v1/updateInfluencerProfile] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }

  /**
   * Update brand profile
   * Accepts all user-editable fields from v1_users and v1_brand_profiles
   * Handles image uploads for brand_logo_url
   */
  async updateBrandProfile(userId, profileData) {
    try {
      // 1) Handle brand logo - file upload takes priority over direct URL
      let brandLogoUrl = null;
      if (profileData.brand_logo_file) {
        // File upload - upload to storage
        const { url, error: uploadError } = await uploadImageToStorage(
          profileData.brand_logo_file.buffer,
          profileData.brand_logo_file.originalname,
          "brands"
        );

        if (uploadError || !url) {
          console.error(
            "[v1/updateBrandProfile] Logo upload error:",
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
      }

      // 2) Update v1_users table (editable fields: name, email, phone_number)
      const userUpdate = {};
      if (profileData.name !== undefined) {
        const nameValue = profileData.name !== null && profileData.name !== undefined
          ? String(profileData.name).trim()
          : null;
        // Name is required (NOT NULL) in schema, so validate it's not empty
        if (!nameValue || nameValue.length === 0) {
          return { success: false, message: "Name is required and cannot be empty" };
        }
        userUpdate.name = nameValue;
      }
      if (profileData.email !== undefined) {
        const emailValue = profileData.email !== null && profileData.email !== undefined
          ? String(profileData.email).trim() || null
          : null;
        // Email is required (NOT NULL) in schema, so validate it's not empty
        if (!emailValue || emailValue.length === 0) {
          return { success: false, message: "Email is required and cannot be empty" };
        }
        // Validate email format if provided
        if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
          return { success: false, message: "Invalid email format" };
        }
        userUpdate.email = emailValue;
      }
      if (profileData.phone_number !== undefined) {
        userUpdate.phone_number = profileData.phone_number !== null && profileData.phone_number !== undefined
          ? String(profileData.phone_number).trim() || null
          : null;
      }

      if (Object.keys(userUpdate).length > 0) {
        // First check if user exists
        const { data: existingUser, error: checkError } = await supabaseAdmin
          .from("v1_users")
          .select("id")
          .eq("id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (checkError) {
          console.error(
            "[v1/updateBrandProfile] User check error:",
            checkError
          );
          return { success: false, message: "Failed to verify user" };
        }

        if (!existingUser) {
          return { success: false, message: "User not found or deleted" };
        }

        const { error: userUpdateError } = await supabaseAdmin
          .from("v1_users")
          .update(userUpdate)
          .eq("id", userId)
          .eq("is_deleted", false);

        if (userUpdateError) {
          console.error(
            "[v1/updateBrandProfile] User update error:",
            userUpdateError
          );
          // If image was uploaded but user update failed, delete the uploaded image
          if (brandLogoUrl) {
            await deleteImageFromStorage(brandLogoUrl);
          }
          
          // Return more specific error message
          let errorMessage = "Failed to update user data";
          if (userUpdateError.code === "23505") {
            errorMessage = "Email already exists";
          } else if (userUpdateError.message) {
            errorMessage = userUpdateError.message;
          }
          
          return { success: false, message: errorMessage };
        }
      }

      // 3) Update v1_brand_profiles table
      const profileUpdate = {};

      // Update pan_number if provided
      if (profileData.pan_number !== undefined) {
        if (
          profileData.pan_number === null ||
          profileData.pan_number === undefined
        ) {
          profileUpdate.pan_number = null;
        } else {
          const trimmed = String(profileData.pan_number).trim();
          profileUpdate.pan_number = trimmed || null;
        }
      }

      // Update brand_name if provided (required field - NOT NULL in schema)
      if (profileData.brand_name !== undefined) {
        if (
          profileData.brand_name === null ||
          profileData.brand_name === undefined
        ) {
          return { success: false, message: "Brand name is required and cannot be null" };
        } else {
          const trimmed = String(profileData.brand_name).trim();
          if (!trimmed || trimmed.length === 0) {
            return { success: false, message: "Brand name is required and cannot be empty" };
          }
          profileUpdate.brand_name = trimmed;
        }
      }

      // Update bio if provided
      if (profileData.bio !== undefined) {
        if (profileData.bio === null || profileData.bio === undefined) {
          profileUpdate.bio = null;
        } else {
          const trimmed = String(profileData.bio).trim();
          profileUpdate.bio = trimmed || null;
        }
      }

      // Update brand_description if provided
      if (profileData.brand_description !== undefined) {
        if (profileData.brand_description === null || profileData.brand_description === undefined) {
          profileUpdate.brand_description = null;
        } else {
          const trimmed = String(profileData.brand_description).trim();
          profileUpdate.brand_description = trimmed || null;
        }
      }

      // Update gender if provided
      if (profileData.gender !== undefined) {
        profileUpdate.gender = this.normalizeGender(profileData.gender);
      }

      // Update brand_logo_url if provided (required field - NOT NULL in schema)
      if (brandLogoUrl !== null) {
        profileUpdate.brand_logo_url = brandLogoUrl;
      } else if (profileData.brand_logo_url !== undefined) {
        if (profileData.brand_logo_url === null || profileData.brand_logo_url === "") {
          return { success: false, message: "Brand logo URL is required and cannot be null" };
        } else {
          const trimmed = String(profileData.brand_logo_url).trim();
          if (!trimmed || trimmed.length === 0) {
            return { success: false, message: "Brand logo URL is required and cannot be empty" };
          }
          profileUpdate.brand_logo_url = trimmed;
        }
      }

      let updatedProfile = null;

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
            "[v1/updateBrandProfile] Profile update error:",
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
        // Fetch existing profile if no updates
        const { data, error: fetchError } = await supabaseAdmin
          .from("v1_brand_profiles")
          .select("*")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .single();

        if (fetchError) {
          console.error(
            "[v1/updateBrandProfile] Profile fetch error:",
            fetchError
          );
          return { success: false, message: "Profile not found" };
        }

        updatedProfile = data;
      }

      // 4) Fetch all user data
      const { data: userData, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("id", userId)
        .eq("is_deleted", false)
        .single();

      if (userError) {
        console.error(
          "[v1/updateBrandProfile] Error fetching user data:",
          userError
        );
      }

      // Filter out sensitive/unnecessary fields from user data
      let filteredUserData = null;
      if (userData) {
        const { is_deleted, password_hash, password_reset_token, password_reset_token_expires_at, ...rest } = userData;
        filteredUserData = rest;
      }

      return {
        success: true,
        user: filteredUserData,
        profile: updatedProfile,
        message: "Profile updated successfully",
      };
    } catch (err) {
      console.error("[v1/updateBrandProfile] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }

  /**
   * Create initial influencer profile during user registration
   * (Used internally by authService during registration)
   */
  async createInfluencerProfile(user, userData) {
    try {
      const primaryLanguage =
        userData?.primary_language ||
        (Array.isArray(userData?.languages) && userData.languages[0]) ||
        null;
  
      const languagesArray = Array.isArray(userData?.languages) 
        ? userData.languages.filter(lang => lang && String(lang).trim().length > 0)
        : null;
  
      const categoriesArray = Array.isArray(userData?.categories)
        ? userData.categories.filter(cat => cat && String(cat).trim().length > 0)
        : null;
  
      const placeholderImageUrl =
        "https://via.placeholder.com/400x400?text=Profile+Image";
  
      const profile = {
        user_id: user.id,
        profile_photo_url: userData?.profile_image_url || placeholderImageUrl,
        is_profile_verified: false,
        bio: userData?.bio || "",
        city: userData?.address_city || userData?.city || null,
        country: userData?.address_country || userData?.country || null,
        primary_language: primaryLanguage,
        languages: languagesArray,
        gender: this.normalizeGender(userData?.gender),
        tier: this.normalizeTier(userData?.tier),
        pan_number: userData?.pan_number || null,
        pan_verified: false,
        profile_completion_pct: 0,
        is_deleted: false,
        categories: categoriesArray,
        min_value: userData?.min_value !== undefined ? parseFloat(userData.min_value) : null,
        max_value: userData?.max_value !== undefined ? parseFloat(userData.max_value) : null,
      };
  
      const { data, error } = await supabaseAdmin
        .from("v1_influencer_profiles")
        .insert(profile)
        .select();
  
      if (error) {
        console.error("[v1/createInfluencerProfile] Database error:", error);
        return { success: false, error: error.message, details: error };
      }
  
      return { success: true, profile: data?.[0] };
    } catch (err) {
      console.error("[v1/createInfluencerProfile] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create initial brand profile during user registration
   * (Used internally by authService during registration)
   */
  async createBrandProfile(user, userData) {
    try {
      const placeholderLogoUrl =
        "https://via.placeholder.com/400x400?text=Brand+Logo";
  
      const brandName = userData?.brand_name || userData?.business_name || "";
  
      const profile = {
        user_id: user.id,
        brand_name: brandName,
        brand_logo_url:
          userData?.brand_logo_url ||
          userData?.profile_image_url ||
          placeholderLogoUrl,
        bio: userData?.bio || null,
        brand_description: userData?.brand_description || null,
        gender: this.normalizeGender(userData?.gender),
        pan_number: userData?.pan_number || null,
        pan_verified: false,
        profile_completion_pct: 0,
        is_deleted: false,
      };
  
      const { data, error } = await supabaseAdmin
        .from("v1_brand_profiles")
        .insert(profile)
        .select("*")
        .single();
  
      if (error) {
        console.error("[v1/createBrandProfile] Database error:", error);
        return { success: false, error: error.message, details: error };
      }
  
      if (!data) {
        console.error("[v1/createBrandProfile] No data returned from insert");
        return { success: false, error: "Profile creation returned no data" };
      }
  
      return { success: true, profile: data };
    } catch (err) {
      console.error("[v1/createBrandProfile] Exception:", err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new ProfileService();
