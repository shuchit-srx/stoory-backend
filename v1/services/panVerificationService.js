const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { supabaseAdmin } = require("../db/config");

class PanVerificationService {
  /**
   * Verify PAN using Zoop API
   * @param {string} pan - PAN number to verify
   * @param {string} userId - Optional user ID for authenticated requests
   * @param {string} userRole - User role (INFLUENCER or BRAND_OWNER)
   * @param {object} options - Additional options (consent_text, task_id)
   * @returns {Promise<object>} Verification result
   */
  async verifyPAN(pan, userId = null, userRole = null, options = {}) {
    try {
      // Normalize PAN
      const normalizedPAN = pan.toString().trim().toUpperCase();

      // Validate PAN format
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!normalizedPAN || !panRegex.test(normalizedPAN)) {
        return {
          success: false,
          message: "Invalid PAN format. Expected AAAAA9999A",
          error_type: "invalid_format",
        };
      }

      // If user is authenticated, check existing PAN status
      if (userId && userRole) {
        const existingPAN = await this.getUserPANStatus(userId, userRole);

        if (existingPAN) {
          // Check if this exact PAN is already verified
        if (
          existingPAN.pan_verified &&
          existingPAN.pan_number === normalizedPAN
        ) {
          return {
            success: true,
            message: "PAN already verified",
            result: {
              pan_number: existingPAN.pan_number,
              pan_status: "VALID",
              status: "VALID",
              user_full_name: existingPAN.pan_holder_name,
              already_verified: true,
              verified_at: existingPAN.pan_verified_at,
            },
            verified: true,
            already_verified: true,
            ...(existingPAN.pan_holder_name ? { holder_name: existingPAN.pan_holder_name } : {}),
          };
        }

          // Check if user has a different PAN that's already verified
          if (
            existingPAN.pan_verified &&
            existingPAN.pan_number &&
            existingPAN.pan_number !== normalizedPAN
          ) {
            return {
              success: false,
              message: `You already have a verified PAN: ${existingPAN.pan_number}. Cannot verify a different PAN.`,
              error_type: "different_pan_exists",
            };
          }
        }
      }

      // Check Zoop credentials
      const hasHeaderLiteCreds =
        !!(process.env.ZOOP_APP_ID && process.env.ZOOP_API_KEY);
      if (!hasHeaderLiteCreds) {
        return {
          success: false,
          message: "Zoop credentials missing. Set ZOOP_APP_ID and ZOOP_API_KEY.",
          error_type: "missing_credentials",
        };
      }

      // Prepare Zoop API request
      const url = process.env.ZOOP_API_URL;
      const headers = {
        "Content-Type": "application/json",
        "app-id": process.env.ZOOP_APP_ID,
        "api-key": process.env.ZOOP_API_KEY,
      };

      const payload = {
        mode: "sync",
        data: {
          customer_pan_number: normalizedPAN,
          consent: "Y",
          consent_text:
            options.consent_text || "I authorize Zoop to verify my PAN details.",
        },
        task_id: options.task_id || uuidv4(),
      };

      // Call Zoop API
      const response = await axios.post(url, payload, {
        headers,
        timeout: 30000, // 30 second timeout
      });

      // Log raw response in development
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[v1/PAN] Raw Zoop response:",
          JSON.stringify(response?.data, null, 2)
        );
      }

      // Normalize Zoop response
      const data = response?.data || {};
      let isValid = false;
      let holderName = null;
      let responseCode = data?.response_code;
      let errorMessage = null;

      // Check for error responses
      if (data?.status === "failed" || data?.success === false || data?.error) {
        errorMessage =
          data?.message ||
          data?.error?.message ||
          data?.response_message ||
          "PAN verification failed";
        return {
          success: false,
          message: errorMessage,
          error_type: "verification_failed",
        };
      }

      // Extract result from various possible response structures
      const resultObj = data?.result || data?.data || data?.response || data || {};

      // Extract holder name
      holderName =
        resultObj?.user_full_name ||
        resultObj?.name ||
        resultObj?.holder_name ||
        resultObj?.customer_name ||
        data?.user_full_name ||
        data?.name ||
        null;

      // Extract status
      const status = (
        resultObj?.pan_status ||
        resultObj?.status ||
        resultObj?.verification_status ||
        data?.pan_status ||
        data?.status ||
        ""
      ).toUpperCase();

      // Determine validity - prioritize pan_status field from result
      // If pan_status is explicitly "VALID", consider it valid regardless of response_code format
      const hasValidStatus = status === "VALID" || status === "SUCCESS";
      const hasValidTransaction = data?.transaction_status === 1;
      const hasValidStatusCode = data?.status_code === 200;
      // Response codes starting with "2" are typically success, but don't rely solely on this
      const hasValidResponseCode = data?.response_code && String(data.response_code).startsWith("2");
      const hasExplicitValidFlag = resultObj?.is_valid === true;
      
      // Check for explicit invalid indicators
      const hasInvalidStatus = status === "INVALID" || status === "FAILED" || status === "ERROR";
      
      // If pan_status is explicitly "VALID", it's valid regardless of response_code
      if (status === "VALID" || resultObj?.pan_status === "VALID" || data?.pan_status === "VALID") {
        isValid = true;
      }
      // If we have clear success indicators and no invalid status, consider valid
      else if (hasValidStatus || hasValidTransaction || hasValidStatusCode || hasValidResponseCode || hasExplicitValidFlag) {
        isValid = !hasInvalidStatus;
      }
      // If status is empty or unclear, and we don't have other positive indicators, consider invalid
      else {
        isValid = false;
      }

      // Get response code
      responseCode =
        data?.response_code ??
        data?.transaction_status ??
        data?.status_code ??
        responseCode;

      // IMPORTANT: Only save to database if PAN is verified as valid
      // If verification failed or is invalid, do NOT save
      if (isValid && userId && userRole) {
        console.log("[v1/PAN] Attempting to save PAN verification to database:", {
          pan: normalizedPAN,
          userId,
          userRole,
          holderName,
        });
        
        const updateResult = await this.updatePANVerificationStatus(
          userId,
          userRole,
          normalizedPAN,
          holderName
        );

        if (!updateResult.success) {
          console.error("[v1/PAN] Failed to save PAN verification:", {
            error: updateResult.message,
            error_type: updateResult.error_type,
            pan: normalizedPAN,
            userId,
          });
          return {
            success: false,
            message: updateResult.message,
            error_type: updateResult.error_type || "database_error",
            // Include verification result even though save failed
            verified: isValid,
            ...(holderName ? { holder_name: holderName } : {}),
          };
        }
        
        console.log("[v1/PAN] PAN verification saved successfully to database");
      } else if (!isValid && userId && userRole) {
        // Explicitly log when we're not saving an invalid PAN
        console.log("[v1/PAN] PAN verification failed - not saving to database:", {
          pan: normalizedPAN,
          userId,
          status,
          responseCode,
        });
      } else if (isValid && (!userId || !userRole)) {
        // Log when PAN is valid but user is not authenticated
        console.log("[v1/PAN] PAN verification successful but not saving - user not authenticated:", {
          pan: normalizedPAN,
          userId: userId || "missing",
          userRole: userRole || "missing",
          message: "Authentication required to save PAN verification to profile",
        });
      }

      // Return verification result
      const responsePayload = {
        success: true,
        result: resultObj,
        verified: isValid,
        ...(holderName ? { holder_name: holderName } : {}),
        ...(responseCode ? { response_code: responseCode } : {}),
      };

      return responsePayload;
    } catch (error) {
      // Handle timeout errors
      if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
        return {
          success: false,
          message: "PAN verification request timed out. Please try again.",
          error_type: "timeout",
        };
      }

      // Handle network errors
      if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        return {
          success: false,
          message:
            "PAN verification service is currently unavailable. Please try again later.",
          error_type: "service_unavailable",
        };
      }

      const httpStatus = error?.response?.status || 500;
      const vendorError = error?.response?.data || { message: error.message };
      let message =
        vendorError?.response_message ||
        vendorError?.message ||
        "PAN verification failed";

      if (vendorError?.response_code === "106") {
        message = "Invalid PAN or input combination";
      }

      return {
        success: false,
        message,
        error_type: "api_error",
        http_status: httpStatus === 200 ? 500 : httpStatus,
      };
    }
  }

  /**
   * Get user's current PAN status from database
   */
  async getUserPANStatus(userId, userRole) {
    try {
      const tableName =
        userRole === "INFLUENCER"
          ? "v1_influencer_profiles"
          : "v1_brand_profiles";

      const { data, error } = await supabaseAdmin
        .from(tableName)
        .select("pan_number, pan_verified, pan_verified_at, pan_holder_name")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (error) {
        console.error("[v1/PAN] Error fetching PAN status:", error);
        return null;
      }

      return data;
    } catch (err) {
      console.error("[v1/PAN] Exception fetching PAN status:", err);
      return null;
    }
  }

  /**
   * Update PAN verification status in database
   * Saves: pan_number, pan_verified, pan_verified_at, pan_holder_name
   */
  async updatePANVerificationStatus(userId, userRole, pan, holderName) {
    try {
      const tableName =
        userRole === "INFLUENCER"
          ? "v1_influencer_profiles"
          : "v1_brand_profiles";

      // First, check if the user's profile exists
      const { data: userProfile, error: profileError } = await supabaseAdmin
        .from(tableName)
        .select("user_id, pan_number, pan_verified")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (profileError) {
        console.error("[v1/PAN] Error checking user profile:", {
          error: profileError,
          userId,
          userRole,
          tableName,
        });
        return {
          success: false,
          message: "User profile not found. Please complete your profile first.",
          error_type: "profile_not_found",
        };
      }

      if (!userProfile) {
        console.error("[v1/PAN] User profile does not exist:", {
          userId,
          userRole,
          tableName,
        });
        return {
          success: false,
          message: "User profile not found. Please complete your profile first.",
          error_type: "profile_not_found",
        };
      }

      // Check if another user already has this PAN (uniqueness across users)
      const { data: existingProfile, error: checkError } = await supabaseAdmin
        .from(tableName)
        .select("user_id")
        .eq("pan_number", pan)
        .neq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (checkError) {
        console.error("[v1/PAN] Error checking for duplicate PAN:", {
          error: checkError,
          pan,
          userId,
        });
        return {
          success: false,
          message: "Failed to verify PAN uniqueness. Please try again.",
          error_type: "database_error",
        };
      }

      if (existingProfile) {
        console.log("[v1/PAN] Duplicate PAN detected:", {
          pan,
          existingUserId: existingProfile.user_id,
          currentUserId: userId,
        });
        return {
          success: false,
          message:
            "This PAN number is already registered with another account. Please contact support if this is your PAN.",
          error_type: "duplicate_pan",
        };
      }

      // Check if current user already has a different PAN verified
      // This ensures uniqueness per user (one PAN per user)
      if (userProfile.pan_verified && userProfile.pan_number && userProfile.pan_number !== pan) {
        console.log("[v1/PAN] User already has a different verified PAN:", {
          existingPAN: userProfile.pan_number,
          newPAN: pan,
          userId,
        });
        return {
          success: false,
          message: `You already have a verified PAN: ${userProfile.pan_number}. Cannot verify a different PAN.`,
          error_type: "different_pan_exists",
        };
      }

      // Update PAN verification status
      const updateData = {
        pan_number: pan,
        pan_verified: true,
        pan_verified_at: new Date().toISOString(),
        pan_holder_name: holderName || null,
      };

      console.log("[v1/PAN] Attempting to update PAN verification:", {
        userId,
        userRole,
        tableName,
        pan,
        updateData,
      });

      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from(tableName)
        .update(updateData)
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .select("pan_number, pan_verified, pan_verified_at, pan_holder_name")
        .single();

      if (updateError) {
        console.error(
          "[v1/PAN] Failed to update PAN verification:",
          {
            error: updateError,
            errorCode: updateError.code,
            errorMessage: updateError.message,
            errorDetails: updateError.details,
            userId,
            userRole,
            tableName,
            pan,
          }
        );

        // Check for unique constraint violation
        if (
          updateError.code === "23505" ||
          updateError.message?.includes("unique") ||
          updateError.message?.includes("duplicate") ||
          updateError.message?.includes("violates unique constraint")
        ) {
          return {
            success: false,
            message:
              "This PAN number is already registered with another account.",
            error_type: "duplicate_pan",
          };
        }

        // Check for foreign key or constraint violations
        if (
          updateError.code === "23503" ||
          updateError.message?.includes("foreign key") ||
          updateError.message?.includes("constraint")
        ) {
          return {
            success: false,
            message: "Database constraint violation. Please contact support.",
            error_type: "constraint_violation",
          };
        }

        // Check if row was not found (shouldn't happen since we checked above, but handle it)
        if (updateError.code === "PGRST116" || updateError.message?.includes("No rows")) {
          return {
            success: false,
            message: "User profile not found. Please complete your profile first.",
            error_type: "profile_not_found",
          };
        }

        return {
          success: false,
          message: `Failed to save PAN verification: ${updateError.message || "Database error"}. Please try again.`,
          error_type: "database_error",
        };
      }

      if (!updatedProfile) {
        console.error("[v1/PAN] Update succeeded but no profile returned:", {
          userId,
          userRole,
          tableName,
          pan,
        });
        return {
          success: false,
          message: "PAN verification update completed but could not retrieve updated profile. Please verify your profile.",
          error_type: "database_error",
        };
      }

      console.log("[v1/PAN] PAN verification updated successfully:", {
        pan_number: updatedProfile?.pan_number,
        pan_verified: updatedProfile?.pan_verified,
        pan_verified_at: updatedProfile?.pan_verified_at,
        pan_holder_name: updatedProfile?.pan_holder_name,
        userId,
        userRole,
      });

      return { success: true, profile: updatedProfile };
    } catch (err) {
      console.error("[v1/PAN] Exception updating PAN verification:", {
        error: err,
        message: err.message,
        stack: err.stack,
        userId,
        userRole,
        pan,
      });
      return {
        success: false,
        message: `Failed to update PAN verification: ${err.message || "Unexpected error"}`,
        error_type: "database_error",
      };
    }
  }
}

module.exports = new PanVerificationService();

