const authService = require("../utils/auth");
const { supabaseAdmin } = require("../supabase/client");
const { body, validationResult } = require("express-validator");
const { uploadImageToStorage, deleteImageFromStorage } = require("../utils/imageUpload");

class AuthController {
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

      const result = await authService.verifyOTP(phone, token, userData);

      if (result.success) {
        res.json({
          success: true,
          user: result.user,
          token: result.token,
          message: "Authentication successful",
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
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
   * Get current user profile
   */
  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      const { data: user, error } = await supabaseAdmin
        .from("users")
        .select(
          `
                    *,
                    social_platforms (*)
                `
        )
        .eq("id", userId)
        .eq("is_deleted", false)
        .single();

      if (error || !user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        user: user,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const updateData = req.body;

      // Remove sensitive fields that shouldn't be updated
      delete updateData.id;
      delete updateData.phone;
      delete updateData.created_at;
      delete updateData.updated_at;

      // Handle profile image upload if present
      if (req.file) {
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

        updateData.profile_image_url = url;
      }

      const { data: updatedUser, error } = await supabaseAdmin
        .from("users")
        .update(updateData)
        .eq("id", userId)
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to update profile",
        });
      }

      res.json({
        success: true,
        user: updatedUser,
        message: "Profile updated successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
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
      const userId = req.user.id;

      const result = await authService.refreshToken(userId);

      if (result.success) {
        res.json({
          success: true,
          token: result.token,
          message: "Token refreshed successfully",
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
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
  body("verification_document_type")
    .optional()
    .isIn(["pan_card", "aadhaar_card", "passport", "driving_license", "voter_id"])
    .withMessage("Invalid verification document type"),
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
  body("business_name")
    .optional()
    .isLength({ min: 2, max: 200 })
    .withMessage("Business name must be between 2 and 200 characters"),
  body("business_type")
    .optional()
    .isIn(["individual", "partnership", "private_limited", "public_limited", "llp", "sole_proprietorship"])
    .withMessage("Invalid business type"),
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
