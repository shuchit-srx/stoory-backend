const { supabaseAdmin } = require("../db/config");
const { uploadImageToStorage, deleteImageFromStorage } = require("../utils/imageUpload");
const {
  normalizeGender,
  normalizeTier,
  normalizePlatform,
} = require("../utils/enumNormalizer");

class ProfileService {

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
          const platformName = normalizePlatform(
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

      // 2) Update v1_users table (editable fields: name, email, phone_number, dob, upi_id)
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
      if (profileData.dob !== undefined) {
        // Handle dob - accept ISO8601 date strings or null, always save in ISO format
        if (profileData.dob !== null && profileData.dob !== undefined && profileData.dob !== "") {
          // Validate it's a valid date string and normalize to ISO format
          const dobDate = new Date(profileData.dob);
          if (!isNaN(dobDate.getTime())) {
            // Always convert to ISO format to ensure consistency
            // This handles both date-only (YYYY-MM-DD) and full ISO (YYYY-MM-DDTHH:mm:ss.sssZ) formats
            userUpdate.dob = dobDate.toISOString();
          } else {
            // Invalid date format, skip update
            console.warn("[v1/updateInfluencerProfile] Invalid dob format:", profileData.dob);
          }
        } else {
          userUpdate.dob = null;
        }
      }
      if (profileData.upi_id !== undefined) {
        // Handle upi_id - validate format and save
        if (profileData.upi_id !== null && profileData.upi_id !== undefined && profileData.upi_id !== "") {
          const upiIdValue = String(profileData.upi_id).trim();
          // Validate UPI ID format: username@provider
          if (/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(upiIdValue)) {
            userUpdate.upi_id = upiIdValue;
          } else {
            return { success: false, message: "Invalid UPI ID format. Must be in format: username@provider" };
          }
        } else {
          userUpdate.upi_id = null;
        }
      }

      // Handle gender - now stored in v1_users table (must be before userUpdate execution)
      if (profileData.gender !== undefined) {
        const normalizedGender = normalizeGender(profileData.gender);
        // Only add to update if normalization succeeded (not null)
        if (normalizedGender !== null) {
          userUpdate.gender = normalizedGender;
        }
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
            errorMessage = "This email is already registered. Please use a different email";
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

      // Handle tier
      if (profileData.tier !== undefined) {
        profileUpdate.tier = normalizeTier(profileData.tier);
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
        // First check if profile exists
        const { data: existingProfile, error: checkError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .select("user_id")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (checkError) {
          console.error(
            "[v1/updateInfluencerProfile] Profile check error:",
            checkError
          );
          if (profileImageUrl) {
            await deleteImageFromStorage(profileImageUrl);
          }
          return { success: false, message: "Failed to verify profile" };
        }

        if (!existingProfile) {
          // Profile doesn't exist, create it
          const placeholderImageUrl = "https://via.placeholder.com/400x400?text=Profile+Image";
          const newProfile = {
            user_id: userId,
            profile_photo_url: profileImageUrl || placeholderImageUrl,
            is_profile_verified: false,
            bio: profileUpdate.bio || "",
            city: profileUpdate.city || null,
            country: profileUpdate.country || null,
            primary_language: profileUpdate.primary_language || null,
            languages: profileUpdate.languages || null,
            tier: profileUpdate.tier || null,
            pan_number: profileUpdate.pan_number || null,
            pan_verified: false,
            profile_completion_pct: 0,
            is_deleted: false,
            categories: profileUpdate.categories || null,
            min_value: profileUpdate.min_value || null,
            max_value: profileUpdate.max_value || null,
          };

          const { data: createdProfile, error: createError } = await supabaseAdmin
            .from("v1_influencer_profiles")
            .insert(newProfile)
            .select()
            .single();

          if (createError) {
            console.error(
              "[v1/updateInfluencerProfile] Profile creation error:",
              createError
            );
            if (profileImageUrl) {
              await deleteImageFromStorage(profileImageUrl);
            }
            return { success: false, message: "Failed to create profile" };
          }

          updatedProfile = createdProfile;
        } else {
          // Profile exists, update it
          const { data, error: updateError } = await supabaseAdmin
            .from("v1_influencer_profiles")
            .update(profileUpdate)
            .eq("user_id", existingProfile.user_id)
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
        }
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

      // 2) Update v1_users table (editable fields: name, email, phone_number, dob, upi_id)
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
      if (profileData.dob !== undefined) {
        // Handle dob - accept ISO8601 date strings or null, always save in ISO format
        if (profileData.dob !== null && profileData.dob !== undefined && profileData.dob !== "") {
          // Validate it's a valid date string and normalize to ISO format
          const dobDate = new Date(profileData.dob);
          if (!isNaN(dobDate.getTime())) {
            // Always convert to ISO format to ensure consistency
            // This handles both date-only (YYYY-MM-DD) and full ISO (YYYY-MM-DDTHH:mm:ss.sssZ) formats
            userUpdate.dob = dobDate.toISOString();
          } else {
            // Invalid date format, skip update
            console.warn("[v1/updateBrandProfile] Invalid dob format:", profileData.dob);
          }
        } else {
          userUpdate.dob = null;
        }
      }
      if (profileData.upi_id !== undefined) {
        // Handle upi_id - validate format and save
        if (profileData.upi_id !== null && profileData.upi_id !== undefined && profileData.upi_id !== "") {
          const upiIdValue = String(profileData.upi_id).trim();
          // Validate UPI ID format: username@provider
          if (/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(upiIdValue)) {
            userUpdate.upi_id = upiIdValue;
          } else {
            return { success: false, message: "Invalid UPI ID format. Must be in format: username@provider" };
          }
        } else {
          userUpdate.upi_id = null;
        }
      }

      // Handle gender - now stored in v1_users table (must be before userUpdate execution)
      if (profileData.gender !== undefined) {
        const normalizedGender = normalizeGender(profileData.gender);
        // Only add to update if normalization succeeded (not null)
        if (normalizedGender !== null) {
          userUpdate.gender = normalizedGender;
        }
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
            errorMessage = "This email is already registered. Please use a different email";
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
        // First check if profile exists
        const { data: existingProfile, error: checkError } = await supabaseAdmin
          .from("v1_brand_profiles")
          .select("user_id")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (checkError) {
          console.error(
            "[v1/updateBrandProfile] Profile check error:",
            checkError
          );
          if (brandLogoUrl) {
            await deleteImageFromStorage(brandLogoUrl);
          }
          return { success: false, message: "Failed to verify profile" };
        }

        if (!existingProfile) {
          // Profile doesn't exist, create it
          const placeholderLogoUrl = "https://via.placeholder.com/400x400?text=Brand+Logo";
          const newProfile = {
            user_id: userId,
            brand_name: profileUpdate.brand_name || "",
            brand_logo_url: brandLogoUrl || placeholderLogoUrl,
            bio: profileUpdate.bio || null,
            brand_description: profileUpdate.brand_description || null,
            pan_number: profileUpdate.pan_number || null,
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
              "[v1/updateBrandProfile] Profile creation error:",
              createError
            );
            if (brandLogoUrl) {
              await deleteImageFromStorage(brandLogoUrl);
            }
            return { success: false, message: "Failed to create profile" };
          }

          updatedProfile = createdProfile;
        } else {
          // Profile exists, update it
          const { data, error: updateError } = await supabaseAdmin
            .from("v1_brand_profiles")
            .update(profileUpdate)
            .eq("user_id", existingProfile.user_id)
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
        }
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
        // gender: removed - now stored in v1_users table
        tier: normalizeTier(userData?.tier),
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
        // gender: removed - now stored in v1_users table
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

  /**
   * Get profile completion steps and progress
   * @param {string} userId - User ID
   * @returns {Promise<Object>} - Completion steps data
   */
  async getProfileCompletionSteps(userId) {
    try {
      // Fetch user data
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

      const role = user.role;
      const completedSteps = [];
      const pendingSteps = [];
      let nextStep = null;

      if (role === "INFLUENCER") {
        // Fetch influencer profile
        const { data: profile } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .select("*")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        // 1. Role Selection - v1_users.role
        if (user.role && user.role === "INFLUENCER") {
          completedSteps.push("role_selection");
        } else {
          pendingSteps.push("role_selection");
        }

        // 2. Gender Selection - v1_users.gender
        if (user.gender) {
          completedSteps.push("gender_selection");
        } else {
          pendingSteps.push("gender_selection");
        }

        // 3. User Details - v1_users.name, email, phone_number
        if (user.name && user.email && user.phone_number) {
          completedSteps.push("user_details");
        } else {
          pendingSteps.push("user_details");
        }

        // 4. Email Verification - v1_users.email_verified
        if (user.email_verified === true) {
          completedSteps.push("email_verification");
        } else {
          pendingSteps.push("email_verification");
        }

        // 5. Date of Birth - v1_users.dob
        if (user.dob) {
          completedSteps.push("date_of_birth");
        } else {
          pendingSteps.push("date_of_birth");
        }

        // 6. Image Upload - v1_influencer_profiles.profile_photo_url (not placeholder)
        const placeholderImageUrl = "https://via.placeholder.com/400x400?text=Profile+Image";
        if (profile?.profile_photo_url && profile.profile_photo_url !== placeholderImageUrl) {
          completedSteps.push("image_upload");
        } else {
          pendingSteps.push("image_upload");
        }

        // 7. KYC PAN - v1_influencer_profiles.pan_number AND pan_verified = true
        if (profile?.pan_number && profile.pan_verified === true) {
          completedSteps.push("kyc_pan");
        } else {
          pendingSteps.push("kyc_pan");
        }

        // 8. UPI ID - v1_users.upi_id
        if (user.upi_id) {
          completedSteps.push("upi");
        } else {
          pendingSteps.push("upi");
        }

        // 9. Profile Details - v1_influencer_profiles.bio
        if (profile?.bio && profile.bio.trim().length > 0) {
          completedSteps.push("profile_details");
        } else {
          pendingSteps.push("profile_details");
        }

        // 10. Social Media - At least one entry in v1_influencer_social_accounts
        const { data: socialAccounts } = await supabaseAdmin
          .from("v1_influencer_social_accounts")
          .select("id")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .limit(1);

        if (socialAccounts && socialAccounts.length > 0) {
          completedSteps.push("social_media");
        } else {
          pendingSteps.push("social_media");
        }

        // 11. Portfolio - At least one entry in v1_influencer_portfolio
        const { data: portfolioItems } = await supabaseAdmin
          .from("v1_influencer_portfolio")
          .select("id")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .limit(1);

        if (portfolioItems && portfolioItems.length > 0) {
          completedSteps.push("portfolio");
        } else {
          pendingSteps.push("portfolio");
        }

        // Find next step (first pending step)
        nextStep = pendingSteps.length > 0 ? pendingSteps[0] : null;

      } else if (role === "BRAND_OWNER") {
        // Fetch brand profile
        const { data: profile } = await supabaseAdmin
          .from("v1_brand_profiles")
          .select("*")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        // 1. Role Selection - v1_users.role
        if (user.role && user.role === "BRAND_OWNER") {
          completedSteps.push("role_selection");
        } else {
          pendingSteps.push("role_selection");
        }

        // 2. Gender Selection - v1_users.gender
        if (user.gender) {
          completedSteps.push("gender_selection");
        } else {
          pendingSteps.push("gender_selection");
        }

        // 3. User Details - v1_users.name, email, phone_number
        if (user.name && user.email && user.phone_number) {
          completedSteps.push("user_details");
        } else {
          pendingSteps.push("user_details");
        }

        // 4. Email Verification - v1_users.email_verified
        if (user.email_verified === true) {
          completedSteps.push("email_verification");
        } else {
          pendingSteps.push("email_verification");
        }

        // 5. Date of Birth - v1_users.dob
        if (user.dob) {
          completedSteps.push("date_of_birth");
        } else {
          pendingSteps.push("date_of_birth");
        }

        // 6. KYC PAN - v1_brand_profiles.pan_number AND pan_verified = true
        if (profile?.pan_number && profile.pan_verified === true) {
          completedSteps.push("kyc_pan");
        } else {
          pendingSteps.push("kyc_pan");
        }

        // 7. UPI ID - v1_users.upi_id
        if (user.upi_id) {
          completedSteps.push("upi");
        } else {
          pendingSteps.push("upi");
        }

        // 8. Brand Business Details - v1_brand_profiles.brand_name AND brand_logo_url (not placeholder)
        const placeholderLogoUrl = "https://via.placeholder.com/400x400?text=Brand+Logo";
        if (
          profile?.brand_name &&
          profile.brand_logo_url &&
          profile.brand_logo_url !== placeholderLogoUrl
        ) {
          completedSteps.push("brand_business_details");
        } else {
          pendingSteps.push("brand_business_details");
        }

        // 9. Brand Details - v1_brand_profiles.brand_description
        if (profile?.brand_description && profile.brand_description.trim().length > 0) {
          completedSteps.push("brand_details");
        } else {
          pendingSteps.push("brand_details");
        }

        // Find next step
        nextStep = pendingSteps.length > 0 ? pendingSteps[0] : null;
      } else {
        return {
          success: false,
          message: "Profile completion not supported for this role",
        };
      }

      // Calculate progress percentage
      const totalSteps = completedSteps.length + pendingSteps.length;
      const progressPercentage = totalSteps > 0
        ? Math.round((completedSteps.length / totalSteps) * 100)
        : 0;

      // Update profile_completion_pct in database
      const profileTable = role === "INFLUENCER" 
        ? "v1_influencer_profiles" 
        : "v1_brand_profiles";
      
      await supabaseAdmin
        .from(profileTable)
        .update({ profile_completion_pct: progressPercentage })
        .eq("user_id", userId)
        .eq("is_deleted", false);

      return {
        success: true,
        data: {
          role: role.toLowerCase(),
          is_complete: pendingSteps.length === 0,
          progress_percentage: progressPercentage,
          completed_steps: completedSteps,
          pending_steps: pendingSteps,
          next_step: nextStep,
        },
      };
    } catch (err) {
      console.error("[v1/getProfileCompletionSteps] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }

  /**
   * Delete (soft delete) a social account for an influencer
   * Sets is_deleted = true for the specified social account
   */
  async deleteSocialAccount(userId, socialAccountId) {
    try {
      // First, verify the user exists and is not deleted
      const { data: user, error: userError } = await supabaseAdmin
        .from("v1_users")
        .select("id, role, is_deleted")
        .eq("id", userId)
        .maybeSingle();

      if (userError) {
        console.error(
          "[v1/deleteSocialAccount] User check error:",
          userError
        );
        return {
          success: false,
          message: "Failed to verify user",
        };
      }

      if (!user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      if (user.is_deleted === true) {
        return {
          success: false,
          message: "User account is deleted",
        };
      }

      if (user.role !== "INFLUENCER") {
        return {
          success: false,
          message: "Only influencers can delete social accounts",
        };
      }

      // Verify the social account exists, belongs to the user, and is not already deleted
      const { data: socialAccount, error: checkError } = await supabaseAdmin
        .from("v1_influencer_social_accounts")
        .select("id, user_id, platform, username, is_deleted")
        .eq("id", socialAccountId)
        .eq("user_id", userId)
        .maybeSingle();

      if (checkError) {
        console.error(
          "[v1/deleteSocialAccount] Check error:",
          checkError
        );
        return {
          success: false,
          message: "Failed to verify social account",
        };
      }

      if (!socialAccount) {
        return {
          success: false,
          message: "Social account not found or does not belong to you",
        };
      }

      if (socialAccount.is_deleted === true) {
        return {
          success: false,
          message: "Social account is already deleted",
        };
      }

      // Soft delete - set is_deleted = true
      const { error: deleteError } = await supabaseAdmin
        .from("v1_influencer_social_accounts")
        .update({
          is_deleted: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", socialAccountId)
        .eq("user_id", userId);

      if (deleteError) {
        console.error(
          "[v1/deleteSocialAccount] Delete error:",
          deleteError
        );
        return {
          success: false,
          message: "Failed to delete social account",
        };
      }

      return {
        success: true,
        message: "Social account deleted successfully",
        deleted_account: {
          id: socialAccount.id,
          platform: socialAccount.platform,
          username: socialAccount.username,
        },
      };
    } catch (err) {
      console.error("[v1/deleteSocialAccount] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }
}

module.exports = new ProfileService();
