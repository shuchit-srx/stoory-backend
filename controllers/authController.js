const authService = require("../utils/auth");
const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult } = require("express-validator");
const { uploadImageToStorage, deleteImageFromStorage } = require("../utils/imageUpload");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { retrySupabaseQuery } = require("../utils/supabaseRetry");

class AuthController {
  /**
   * Verify PAN using Zoop
   * If user is authenticated and PAN is already verified, returns early without API call
   * On successful verification, updates database with verification status
   */
  async verifyPAN(req, res) {
    try {
      const panInput = req.body?.pan || req.body?.pan_number || req.query?.pan || "";
      const pan = panInput.toString().trim().toUpperCase();
      const userId = req.user?.id; // Optional: user may or may not be authenticated

      // Basic PAN format validation
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!pan || !panRegex.test(pan)) {
        return res.status(400).json({
          success: false,
          message: "Invalid PAN format. Expected AAAAA9999A",
        });
      }

      // If user is authenticated, check existing PAN status
      if (userId) {
        const { data: user, error: userError } = await supabaseAdmin
          .from("users")
          .select("pan_number, pan_verified, pan_verified_at, pan_holder_name, verification_status, role")
          .eq("id", userId)
          .single();

        if (!userError && user) {
          // Check if this exact PAN is already verified for this user
          if (user.pan_verified && user.pan_number === pan) {
            return res.json({
              success: true,
              message: "PAN already verified",
              result: {
                user_full_name: user.pan_holder_name,
                pan_status: "VALID",
                status: "VALID",
                already_verified: true,
                verified_at: user.pan_verified_at
              },
              verified: true,
              already_verified: true
            });
          }

          // Check if user has a different PAN that's already verified
          // ALLOW RE-VERIFICATION IF STATUS IS REJECTED
          // This handles the case where a user verified a personal PAN but needs a business PAN (brand owner)
          if (user.pan_verified && user.pan_number && user.pan_number !== pan) {
            if (user.verification_status === 'rejected') {
              console.log(`🔄 [verifyPAN] User has verified PAN ${user.pan_number} but status is REJECTED. Allowing re-verification with new PAN ${pan}.`);
            } else {
              return res.status(400).json({
                success: false,
                message: `You already have a verified PAN: ${user.pan_number}. Cannot verify a different PAN.`,
              });
            }
          }

          // If user has the same PAN in database but not verified, we'll verify it
          // (continue to Zoop API call below)
          if (user.pan_number === pan && !user.pan_verified) {
            console.log(`🔍 [verifyPAN] User has PAN ${pan} in database but not verified. Proceeding with verification.`);
          }
        }
      }

      // Require Zoop header-lite credentials (app-id + api-key)
      const hasHeaderLiteCreds = !!(process.env.ZOOP_APP_ID && process.env.ZOOP_API_KEY);

      let url;
      const headers = { "Content-Type": "application/json" };
      let payload;

      if (!hasHeaderLiteCreds) {
        return res.status(500).json({
          success: false,
          message: "Zoop credentials missing. Set ZOOP_APP_ID and ZOOP_API_KEY.",
        });
      }

      //ZOOP PAN LITE URL
      url = process.env.ZOOP_API_URL;
      headers["app-id"] = process.env.ZOOP_APP_ID;
      headers["api-key"] = process.env.ZOOP_API_KEY;
      // Always send full Zoop v1 payload (works for live and test)
      payload = {
        mode: "sync",
        data: {
          customer_pan_number: pan,
          consent: "Y",
          consent_text: req.body?.consent_text || "I authorize Zoop to verify my PAN details.",
        },
        task_id: req.body?.task_id || uuidv4(),
      };

      // Set timeout for Zoop API call (30 seconds)
      const response = await axios.post(url, payload, {
        headers,
        timeout: 30000 // 30 second timeout
      });

      // Log raw response for debugging (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 [verifyPAN] Raw Zoop response:', JSON.stringify(response?.data, null, 2));
      }

      // Normalize Zoop response
      const data = response?.data || {};
      let isValid = false;
      let holderName = null;
      let responseCode = data?.response_code;
      let errorMessage = null;

      // Check for error responses first
      if (data?.status === 'failed' || data?.success === false || data?.error) {
        errorMessage = data?.message || data?.error?.message || data?.response_message || 'PAN verification failed';
        return res.status(400).json({
          success: false,
          message: errorMessage,
          vendor_error: data,
          error_type: "verification_failed"
        });
      }

      // Header lite response shape (handle both live v1 and test v1)
      // Try multiple possible response structures
      const resultObj = data?.result || data?.data || data?.response || data || {};

      // Extract holder name from various possible fields
      holderName = resultObj?.user_full_name ||
        resultObj?.name ||
        resultObj?.holder_name ||
        resultObj?.customer_name ||
        data?.user_full_name ||
        data?.name ||
        null;

      // Extract status from various possible fields
      const status = (resultObj?.pan_status ||
        resultObj?.status ||
        resultObj?.verification_status ||
        data?.pan_status ||
        data?.status ||
        "").toUpperCase();

      // Check if valid - multiple ways to determine validity
      isValid = status === "VALID" ||
        status === "SUCCESS" ||
        data?.transaction_status === 1 ||
        data?.status_code === 200 ||
        (data?.response_code && String(data.response_code).startsWith('2')) ||
        (resultObj?.is_valid === true);

      // Get response code
      responseCode = data?.response_code ??
        data?.transaction_status ??
        data?.status_code ??
        responseCode;

      // If result object is empty but we got a 200 response, log warning
      if (Object.keys(resultObj).length === 0 && !isValid) {
        console.warn('⚠️ [verifyPAN] Empty result object from Zoop API. Response:', JSON.stringify(data, null, 2));
      }

      // If verification is successful and user is authenticated, update database
      if (isValid && userId) {
        // Check if another user already has this PAN number
        const { data: existingUser, error: checkError } = await supabaseAdmin
          .from("users")
          .select("id, name")
          .eq("pan_number", pan)
          .neq("id", userId)
          .maybeSingle();

        if (checkError) {
          console.error("❌ [verifyPAN] Error checking for duplicate PAN:", checkError);
          return res.status(500).json({
            success: false,
            message: "Failed to verify PAN. Please try again.",
            error_type: "database_error"
          });
        }

        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: "This PAN number is already registered with another account. Please contact support if this is your PAN.",
            error_type: "duplicate_pan"
          });
        }

        const updateData = {
          pan_number: pan,
          pan_verified: true,
          pan_verified_at: new Date().toISOString(),
          pan_holder_name: holderName || null
        };

        const { data: updatedUser, error: updateError } = await supabaseAdmin
          .from("users")
          .update(updateData)
          .eq("id", userId)
          .select("pan_number, pan_verified, pan_verified_at, pan_holder_name")
          .single();

        if (updateError) {
          console.error("❌ [verifyPAN] Failed to update PAN verification status:", updateError);

          // Check if error is due to unique constraint violation
          if (updateError.code === '23505' || updateError.message?.includes('unique') || updateError.message?.includes('duplicate')) {
            return res.status(400).json({
              success: false,
              message: "This PAN number is already registered with another account. Please contact support if this is your PAN.",
              error_type: "duplicate_pan"
            });
          }

          // For other database errors, return generic error
          return res.status(500).json({
            success: false,
            message: "Failed to save PAN verification. Please try again.",
            error_type: "database_error"
          });
        } else {
          console.log("✅ [verifyPAN] PAN verification status updated in database:", {
            pan_number: updatedUser?.pan_number,
            pan_verified: updatedUser?.pan_verified,
            pan_verified_at: updatedUser?.pan_verified_at
          });
        }
      }

      // Return the PAN verification result payload
      const responsePayload = {
        success: true,
        result: resultObj,
        verified: isValid,
        ...(holderName ? { holder_name: holderName } : {}),
        ...(responseCode ? { response_code: responseCode } : {}),
        ...(userId && isValid ? { saved_to_profile: true } : {})
      };

      // If result is empty, include raw data for debugging
      if (Object.keys(resultObj).length === 0) {
        responsePayload.debug = {
          raw_response: data,
          message: "Zoop API returned empty result. Check raw_response for details."
        };
      }

      return res.json(responsePayload);
    } catch (error) {
      // Handle timeout errors
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        return res.status(504).json({
          success: false,
          message: "PAN verification request timed out. Please try again.",
          error_type: "timeout"
        });
      }

      // Handle network errors
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          success: false,
          message: "PAN verification service is currently unavailable. Please try again later.",
          error_type: "service_unavailable"
        });
      }

      const httpStatus = error?.response?.status || 500;
      const vendorError = error?.response?.data || { message: error.message };
      let message = vendorError?.response_message || vendorError?.message || "PAN verification failed";
      if (vendorError?.response_code === "106") {
        message = "Invalid PAN or input combination";
      }
      return res.status(httpStatus === 200 ? 500 : httpStatus).json({
        success: false,
        message,
        vendor_error: vendorError,
        error_type: "api_error"
      });
    }
  }
  /**
   * Send OTP to phone number via WhatsApp (for existing users)
   */
  async sendOTP(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { phone } = req.body;

      const result = await authService.sendOTP(phone);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
          code: result.code,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Send OTP for registration (new users)
   */
  async sendRegistrationOTP(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { phone } = req.body;

      const result = await authService.sendRegistrationOTP(phone);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
          code: result.code,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Verify OTP and create user session
   */
  async verifyOTP(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { phone, token, userData } = req.body;

      console.log('🔍  OTP Verification Request:', {
        phone,
        token: token ? '***' : 'missing',
        userData: userData ? 'provided' : 'not provided'
      });

      const result = await authService.verifyOTP(phone, token, userData);

      if (result.success) {
        res.json({
          success: true,
          user: result.user,
          token: result.token,
          refreshToken: result.refreshToken,
          message: "Authentication successful",
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
        });
      }
    } catch (error) {
      console.error('❌ [ERROR] OTP Verification Error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Send OTP for changing phone number
   */
  async sendChangePhoneOTP(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { new_phone } = req.body;
      const userId = req.user.id;

      // Ensure new phone is different from current
      const { data: currentUser } = await supabaseAdmin
        .from("users")
        .select("phone")
        .eq("id", userId)
        .single();

      if (currentUser && currentUser.phone === new_phone) {
        return res.status(400).json({
          success: false,
          message: "New phone number must be different from current phone number"
        });
      }

      const result = await authService.sendChangePhoneOTP(new_phone);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
          code: result.code,
        });
      }
    } catch (error) {
      console.error('❌ [sendChangePhoneOTP] Error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Verify OTP and update phone number
   */
  async verifyChangePhoneOTP(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { new_phone, otp } = req.body;
      const userId = req.user.id;

      // Verify OTP
      const verifyResult = await authService.verifyStoredOTP(new_phone, otp);
      if (!verifyResult.success) {
        return res.status(400).json({
          success: false,
          message: verifyResult.message
        });
      }

      // Update user's phone number
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from("users")
        .update({ phone: new_phone })
        .eq("id", userId)
        .select()
        .single();

      if (updateError) {
        console.error('❌ [verifyChangePhoneOTP] Database update error:', updateError);
        return res.status(500).json({
          success: false,
          message: "Failed to update phone number. Please try again."
        });
      }

      res.json({
        success: true,
        message: "Phone number updated successfully",
        user: updatedUser
      });

    } catch (error) {
      console.error('❌ [verifyChangePhoneOTP] Error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get current user profile
   */
  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      console.log('🔍 [getProfile] Fetching profile for userId:', userId);

      // Try to get user first without relation to avoid relation query errors
      let user = null;
      let userError = null;

      try {
        const { data, error } = await retrySupabaseQuery(
          () => supabaseAdmin
            .from("users")
            .select("*")
            .eq("id", userId)
            .maybeSingle(),
          { maxRetries: 3, initialDelay: 200 }
        );

        if (error) {
          userError = error;
          console.error('❌ [getProfile] Supabase error fetching user:', error);
          console.error('❌ [getProfile] Error code:', error.code);
          console.error('❌ [getProfile] Error details:', JSON.stringify(error, null, 2));
          console.error('❌ [getProfile] Error hint:', error.hint);
        } else {
          user = data;
        }
      } catch (err) {
        userError = err;
        console.error('❌ [getProfile] Exception fetching user:', err);
        console.error('❌ [getProfile] Exception stack:', err.stack);
      }

      if (userError) {
        console.error('❌ [getProfile] Error details:', JSON.stringify(userError, null, 2));

        // Check for specific error types
        if (userError.code === 'PGRST116' || userError.message?.includes('does not exist')) {
          return res.status(404).json({
            success: false,
            message: "User not found"
          });
        }

        // Check if it's a column error
        if (userError.message?.includes('column') || userError.hint?.includes('column')) {
          console.error('❌ [getProfile] Possible missing column in users table');
          return res.status(500).json({
            success: false,
            message: "Database schema error - please check users table structure",
            error: process.env.NODE_ENV === 'development' ? userError.message : undefined
          });
        }

        return res.status(500).json({
          success: false,
          message: "Failed to fetch profile",
          error: process.env.NODE_ENV === 'development' ? (userError.message || JSON.stringify(userError)) : undefined
        });
      }

      if (!user) {
        console.error('❌ [getProfile] User not found for userId:', userId);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Filter out deleted users only if explicitly deleted (not null/undefined)
      // This allows restored users to access their profile
      if (user.is_deleted === true) {
        console.warn('⚠️ [getProfile] User is marked as deleted, but allowing access:', userId);
        // Allow access anyway - user can restore their account
      }

      // Ensure social_platforms is always an array
      // If relation didn't return platforms, fetch them separately (fallback)
      let socialPlatforms = user.social_platforms || [];

      if (!socialPlatforms || socialPlatforms.length === 0) {
        console.log('⚠️ [getProfile] Social platforms not found in relation, fetching separately...');
        const { data: platformsData, error: platformsError } = await supabaseAdmin
          .from('social_platforms')
          .select('id, platform_name, platform, username, profile_link, followers_count, engagement_rate, is_connected, created_at, updated_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (platformsError) {
          console.error('❌ [getProfile] Error fetching platforms separately:', platformsError);
        } else if (platformsData) {
          socialPlatforms = platformsData;
          console.log('✅ [getProfile] Fetched platforms separately:', socialPlatforms.length);
        }
      }

      // Ensure profile_image_url is included (it should be from *, but explicitly ensure it)
      const profileData = {
        ...user,
        profile_image_url: user.profile_image_url || null, // Explicitly ensure profile_image_url is present
        social_platforms: socialPlatforms // Use the fetched platforms array
      };

      console.log('✅ [getProfile] Profile fetched successfully. Has profile_image_url:', !!profileData.profile_image_url);

      res.json({
        success: true,
        user: profileData,
      });
    } catch (error) {
      console.error('❌ [getProfile] Unexpected error:', error);
      console.error('❌ [getProfile] Error stack:', error.stack);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Update user profile
   * NOTE: This endpoint allows ALL users (including brand owners) to update their profile
   * WITHOUT requiring a subscription. Subscription checks should NOT be added here.
   */
  async updateProfile(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.error('❌ [updateProfile] Validation errors:', errors.array());
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user?.id;
      if (!userId) {
        console.error('❌ [updateProfile] No user ID in request');
        return res.status(401).json({
          success: false,
          message: "Authentication required"
        });
      }

      console.log('🔍 [updateProfile] Updating profile for userId:', userId);
      const updateData = req.body;
      console.log('🔍 [updateProfile] Update data keys:', Object.keys(updateData));

      // IMPORTANT: No subscription check here - brand owners can update profile without subscription
      // Remove sensitive fields that shouldn't be updated
      delete updateData.id;
      delete updateData.phone;
      delete updateData.created_at;
      delete updateData.updated_at;
      // PAN verification fields are set by verifyPAN endpoint only
      delete updateData.pan_verified;
      delete updateData.pan_verified_at;
      delete updateData.pan_holder_name;

      // Check if user is trying to update brand fields - only brand_owner can update these
      const hasBrandFields = updateData.brand_name !== undefined ||
        updateData.brand_description !== undefined ||
        updateData.brand_profile_image_url !== undefined ||
        updateData.business_name !== undefined;

      if (hasBrandFields) {
        // Get user's current role
        const { data: currentUser } = await supabaseAdmin
          .from("users")
          .select("role")
          .eq("id", userId)
          .single();

        if (currentUser?.role !== 'brand_owner') {
          // Remove brand fields if user is not a brand owner
          delete updateData.brand_name;
          delete updateData.brand_description;
          delete updateData.brand_profile_image_url;
          delete updateData.business_name;
          console.log('⚠️ [updateProfile] Brand fields removed - user is not a brand owner');
        } else {
          // Map frontend field names to database schema:
          // Frontend sends 'business_name' -> Database expects 'brand_name'
          if (updateData.business_name !== undefined) {
            updateData.brand_name = updateData.business_name;
            delete updateData.business_name;
            console.log('🔄 [updateProfile] Mapped business_name -> brand_name');
          }
        }
      }

      // Normalize array fields to lowercase for consistent filtering
      const arrayFields = ['categories', 'languages', 'locations', 'specializations'];
      arrayFields.forEach(field => {
        if (updateData[field] && Array.isArray(updateData[field])) {
          updateData[field] = updateData[field]
            .filter(item => item && typeof item === 'string')
            .map(item => item.toLowerCase().trim());
          console.log(`🔄 [updateProfile] Normalized ${field} to lowercase`);
        }
      });

      // Remove business_type as it's not in the schema anymore
      if (updateData.business_type !== undefined) {
        delete updateData.business_type;
        console.log('🔄 [updateProfile] Removed business_type (not in schema)');
      }

      // Also handle other legacy business fields that might be sent
      if (updateData.business_website !== undefined) {
        delete updateData.business_website;
      }
      if (updateData.business_address !== undefined) {
        delete updateData.business_address;
      }
      if (updateData.gst_number !== undefined) {
        delete updateData.gst_number;
      }
      if (updateData.business_registration_number !== undefined) {
        delete updateData.business_registration_number;
      }

      // Handle profile image upload if present
      if (req.file) {
        console.log('📸 [updateProfile] Processing profile image upload');
        // Get current user to check for existing profile image
        const { data: currentUser, error: fetchError } = await supabaseAdmin
          .from("users")
          .select("profile_image_url")
          .eq("id", userId)
          .maybeSingle();

        if (fetchError) {
          console.error('❌ [updateProfile] Error fetching current user:', fetchError);
        }

        // Upload new profile image
        const { url, error: uploadError } = await uploadImageToStorage(
          req.file.buffer,
          req.file.originalname,
          "profiles"
        );

        if (uploadError) {
          console.error('❌ [updateProfile] Image upload error:', uploadError);
          return res.status(500).json({
            success: false,
            message: "Failed to upload profile image",
            error: uploadError,
          });
        }

        // Delete old profile image if it exists
        if (currentUser?.profile_image_url) {
          await deleteImageFromStorage(currentUser.profile_image_url);
        }

        updateData.profile_image_url = url;
      }

      // Remove undefined/null values to avoid unnecessary updates
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined || updateData[key] === null) {
          delete updateData[key];
        }
      });

      if (Object.keys(updateData).length === 0) {
        console.log('⚠️ [updateProfile] No fields to update');
        // Fetch and return current user if no updates
        const { data: currentUser } = await supabaseAdmin
          .from("users")
          .select("*")
          .eq("id", userId)
          .single();

        return res.json({
          success: true,
          user: currentUser,
          message: "No changes to update",
        });
      }

      console.log('🔍 [updateProfile] Updating fields:', Object.keys(updateData));

      const { data: updatedUser, error } = await supabaseAdmin
        .from("users")
        .update(updateData)
        .eq("id", userId)
        .select()
        .single();

      if (error) {
        console.error('❌ [updateProfile] Supabase update error:', error);
        console.error('❌ [updateProfile] Error details:', JSON.stringify(error, null, 2));
        return res.status(500).json({
          success: false,
          message: "Failed to update profile",
          error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }

      if (!updatedUser) {
        console.error('❌ [updateProfile] User not found after update:', userId);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      console.log('✅ [updateProfile] Profile updated successfully');

      res.json({
        success: true,
        user: updatedUser,
        message: "Profile updated successfully",
      });
    } catch (error) {
      console.error('❌ [updateProfile] Unexpected error:', error);
      console.error('❌ [updateProfile] Error stack:', error.stack);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Upload verification document
   */
  async uploadVerificationDocument(req, res) {
    try {
      console.log('🔍 [VERIFICATION DEBUG] uploadVerificationDocument called');
      console.log('🔍 [VERIFICATION DEBUG] Request body:', req.body);
      console.log('🔍 [VERIFICATION DEBUG] File present:', !!req.file);
      console.log('🔍 [VERIFICATION DEBUG] File details:', req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : 'No file');

      const userId = req.user.id;
      const { document_type } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      // Validate file type
      const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.'
        });
      }

      // Validate file size (5MB limit)
      if (req.file.size > 5 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: 'File size too large. Maximum size is 5MB.'
        });
      }

      if (!document_type || !['pan_card', 'aadhaar_card', 'passport', 'driving_license', 'voter_id'].includes(document_type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid document type. Must be one of: pan_card, aadhaar_card, passport, driving_license, voter_id'
        });
      }

      // Get current user to check for existing verification image
      const { data: currentUser } = await supabaseAdmin
        .from('users')
        .select('verification_image_url')
        .eq('id', userId)
        .single();

      // Upload new verification document
      const { url, error: uploadError } = await uploadImageToStorage(
        req.file.buffer,
        `verification_${userId}_${Date.now()}.${req.file.originalname.split('.').pop()}`,
        'verification-documents'
      );

      if (uploadError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to upload verification document',
          error: uploadError
        });
      }

      // Delete old verification image if it exists
      if (currentUser?.verification_image_url) {
        await deleteImageFromStorage(currentUser.verification_image_url);
      }

      // Update user with new verification document
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from('users')
        .update({
          verification_image_url: url,
          verification_document_type: document_type
        })
        .eq('id', userId)
        .select()
        .single();

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update verification document'
        });
      }

      res.json({
        success: true,
        message: 'Verification document uploaded successfully',
        verification_image_url: url,
        document_type: document_type
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  /**
   * Upload profile image only
   */
  async uploadProfileImage(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No image file provided",
        });
      }

      const userId = req.user.id;

      // Get current user to check for existing profile image
      const { data: currentUser } = await supabaseAdmin
        .from("users")
        .select("profile_image_url")
        .eq("id", userId)
        .single();

      // Upload new profile image
      const { url, error: uploadError } = await uploadImageToStorage(
        req.file.buffer,
        req.file.originalname,
        "profiles"
      );

      if (uploadError) {
        return res.status(500).json({
          success: false,
          message: "Failed to upload profile image",
          error: uploadError,
        });
      }

      // Delete old profile image if it exists
      if (currentUser?.profile_image_url) {
        await deleteImageFromStorage(currentUser.profile_image_url);
      }

      // Update user profile with new image URL
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from("users")
        .update({ profile_image_url: url })
        .eq("id", userId)
        .select()
        .single();

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to update profile image",
        });
      }

      res.json({
        success: true,
        user: updatedUser,
        message: "Profile image uploaded successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete profile image
   */
  async deleteProfileImage(req, res) {
    try {
      const userId = req.user.id;

      // Get current user to check for existing profile image
      const { data: currentUser } = await supabaseAdmin
        .from("users")
        .select("profile_image_url")
        .eq("id", userId)
        .single();

      if (!currentUser?.profile_image_url) {
        return res.status(404).json({
          success: false,
          message: "No profile image found",
        });
      }

      // Delete image from storage
      const { success, error: deleteError } = await deleteImageFromStorage(
        currentUser.profile_image_url
      );

      if (!success) {
        return res.status(500).json({
          success: false,
          message: "Failed to delete profile image from storage",
          error: deleteError,
        });
      }

      // Update user profile to remove image URL
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from("users")
        .update({ profile_image_url: null })
        .eq("id", userId)
        .select()
        .single();

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to update profile",
        });
      }

      res.json({
        success: true,
        user: updatedUser,
        message: "Profile image deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Logout user (client-side token removal)
   */
  async logout(req, res) {
    try {
      res.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      console.log('🔄 [REFRESH] Received refresh token request');

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: "Refresh token is required",
          code: "REFRESH_TOKEN_REQUIRED"
        });
      }

      const result = await authService.refreshToken(refreshToken);

      if (result.success) {
        console.log('✅ [REFRESH] Token refreshed successfully for user:', result.token ? 'Token generated' : 'No token');
        res.json({
          success: true,
          data: {
            token: result.token,
            refreshToken: result.refreshToken,
          },
        });
      } else {
        console.log('❌ [REFRESH] Failed:', result.message, result.code);
        // Return 401 for expired/invalid tokens to trigger logout
        const status = result.code === "REFRESH_TOKEN_EXPIRED" || result.code === "INVALID_TOKEN_TYPE" ? 401 : 400;
        res.status(status).json({
          success: false,
          message: result.message,
          code: result.code
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete user account (hard delete)
   */
  async deleteAccount(req, res) {
    try {
      const userId = req.user.id;

      // Mark user as deleted
      const { error } = await supabaseAdmin
        .from("users")
        .update({ is_deleted: true })
        .eq("id", userId);

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to delete account",
        });
      }

      res.json({
        success: true,
        message: "Account deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Get mock login information (for testing)
   */
  async getMockLoginInfo(req, res) {
    try {
      res.json({
        success: true,
        mockLogin: {
          description:
            "Use these credentials for testing. This mock login bypasses WhatsApp OTP verification.",
          testUsers: [
            {
              role: "Brand Owner",
              phone: "9876543211",
              otp: "123456",
              description:
                "Test brand owner account for testing campaigns and bids",
            },
            {
              role: "Brand Owner 2",
              phone: "9988776655",
              otp: "123456",
              description:
                "Additional test brand owner account for testing campaigns and bids",
            },
            {
              role: "Influencer",
              phone: "9876543212",
              otp: "123456",
              description:
                "Test influencer account for testing applications and conversations",
            },
            {
              role: "General User",
              phone: "9876543210",
              otp: "123456",
              description: "General test user account",
            },
          ],
          instructions: [
            "1. Use any of the phone numbers above (without +91 prefix)",
            "2. Use OTP: 123456 for all accounts",
            "3. Works for both login and registration",
            "4. Creates test users automatically if they don't exist",
            "5. Perfect for testing frontend functionality without WhatsApp integration",
          ],
          note: "All test users use OTP: 123456 and bypass WhatsApp verification",
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
}

// Validation middleware
const validateSendOTP = [
  body("phone")
    .isMobilePhone("any")
    .withMessage(
      "Please provide a valid phone number with country code (e.g., +1234567890)"
    )
    .custom((value) => {
      // Ensure phone number starts with + and has proper country code
      if (!value.startsWith("+")) {
        throw new Error(
          "Phone number must start with + and include country code"
        );
      }
      // Check if it's a valid international format (7-15 digits after +)
      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(value)) {
        throw new Error(
          "Invalid phone number format. Use international format: +[country code][number]"
        );
      }
      return true;
    }),
];

const validateVerifyOTP = [
  body("phone")
    .isMobilePhone("any")
    .withMessage(
      "Please provide a valid phone number with country code (e.g., +1234567890)"
    )
    .custom((value) => {
      // Ensure phone number starts with + and has proper country code
      if (!value.startsWith("+")) {
        throw new Error(
          "Phone number must start with + and include country code"
        );
      }
      // Check if it's a valid international format (7-15 digits after +)
      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(value)) {
        throw new Error(
          "Invalid phone number format. Use international format: +[country code][number]"
        );
      }
      return true;
    }),
  body("token")
    .isLength({ min: 4, max: 6 })
    .withMessage("OTP token must be 4-6 characters"),
];

const validateUpdateProfile = [
  body("name")
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),
  body("email")
    .optional()
    .isEmail()
    .withMessage("Please provide a valid email"),
  body("role")
    .optional()
    .isIn(["brand_owner", "influencer", "admin"])
    .withMessage("Invalid role"),
  body("gender")
    .optional()
    .isIn(["male", "female", "other"])
    .withMessage("Gender must be male, female, or other"),
  body("min_range")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Min range must be a positive integer"),
  body("max_range")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Max range must be a positive integer"),
  body("languages")
    .optional()
    .isArray()
    .withMessage("Languages must be an array"),
  body("categories")
    .optional()
    .isArray()
    .withMessage("Categories must be an array"),
  // New verification fields
  // Brand profile fields (for brand owners)
  body("brand_name")
    .optional()
    .isLength({ min: 2, max: 200 })
    .withMessage("Brand name must be between 2 and 200 characters"),
  body("brand_description")
    .optional()
    .isLength({ min: 0, max: 1000 })
    .withMessage("Brand description must be up to 1000 characters"),
  body("brand_profile_image_url")
    .optional()
    .isString()
    .withMessage("Brand profile image URL must be a string"),
  body("date_of_birth")
    .optional()
    .isISO8601()
    .withMessage("Date of birth must be a valid date"),
  body("pan_number")
    .optional()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .withMessage("PAN number must be in format: AAAAA9999A"),
  body("verification_document_type")
    .optional()
    .isIn(["pan_card", "aadhaar_card", "passport", "driving_license", "voter_id"])
    .withMessage("Invalid verification document type"),
  body("verification_status")
    .optional()
    .isIn(["pending", "under_review", "verified", "rejected"])
    .withMessage("Invalid verification status"),
  body("is_verified")
    .optional()
    .isBoolean()
    .withMessage("is_verified must be a boolean"),
  body("verification_profile")
    .optional()
    .isObject()
    .withMessage("verification_profile must be an object"),
];

// Validation for verification details
const validateVerificationDetails = [
  body("pan_number")
    .optional()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .withMessage("PAN number must be in format: AAAAA9999A"),
  body("upi_id")
    .optional()
    .matches(/^[\w.-]+@[\w]+$/i)
    .withMessage("UPI ID must be in format: username@provider (e.g., username@paytm, phone@upi)"),
  body("verification_document_type")
    .optional()
    .isIn(["pan_card", "aadhaar_card", "passport", "driving_license", "voter_id"])
    .withMessage("Invalid verification document type"),
  body("verification_image_url")
    .optional()
    .isURL()
    .withMessage("Verification image URL must be a valid URL"),
  body("address_line1")
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage("Address line 1 must be between 5 and 200 characters"),
  body("address_city")
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage("City must be between 2 and 100 characters"),
  body("address_state")
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage("State must be between 2 and 100 characters"),
  body("address_pincode")
    .optional()
    .matches(/^[1-9][0-9]{5}$/)
    .withMessage("Pincode must be 6 digits and not start with 0"),
  body("address_country")
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage("Country must be between 2 and 100 characters"),
  body("date_of_birth")
    .optional()
    .isISO8601()
    .withMessage("Date of birth must be a valid date"),
  body("bio")
    .optional()
    .isLength({ min: 10, max: 1000 })
    .withMessage("Bio must be between 10 and 1000 characters"),
  body("experience_years")
    .optional()
    .isInt({ min: 0, max: 50 })
    .withMessage("Experience years must be between 0 and 50"),
  body("specializations")
    .optional()
    .isArray()
    .withMessage("Specializations must be an array"),
  body("portfolio_links")
    .optional()
    .isArray()
    .withMessage("Portfolio links must be an array"),
  body("emergency_contact_name")
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage("Emergency contact name must be between 2 and 100 characters"),
  body("emergency_contact_phone")
    .optional()
    .isMobilePhone("any")
    .withMessage("Emergency contact phone must be a valid phone number"),
  body("emergency_contact_relation")
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage("Emergency contact relation must be between 2 and 50 characters"),
  // Legacy field names from frontend - mapped to brand_name in updateProfile
  body("business_name")
    .optional()
    .isLength({ min: 2, max: 200 })
    .withMessage("Business/Brand name must be between 2 and 200 characters"),
  body("brand_name")
    .optional()
    .isLength({ min: 2, max: 200 })
    .withMessage("Brand name must be between 2 and 200 characters"),
  // business_type is deprecated - ignored in updateProfile
  body("business_type")
    .optional()
    .isIn(["individual", "partnership", "private_limited", "public_limited", "llp", "sole_proprietorship"])
    .withMessage("Invalid business type (deprecated field, will be ignored)"),
  body("gst_number")
    .optional()
    .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .withMessage("GST number must be in valid format"),
  body("business_registration_number")
    .optional()
    .isLength({ min: 5, max: 50 })
    .withMessage("Business registration number must be between 5 and 50 characters"),
  body("business_address")
    .optional()
    .isLength({ min: 10, max: 500 })
    .withMessage("Business address must be between 10 and 500 characters"),
  body("business_website")
    .optional()
    .isURL()
    .withMessage("Business website must be a valid URL"),
];

// Validation for verification document upload
const validateVerificationDocument = [
  body("document_type")
    .optional()
    .isIn(["pan_card", "aadhaar_card", "passport", "driving_license", "voter_id"])
    .withMessage("Invalid document type"),
];

module.exports = {
  AuthController: new AuthController(),
  validateSendOTP,
  validateVerifyOTP,
  validateUpdateProfile,
  validateVerificationDetails,
  validateVerificationDocument,
};
