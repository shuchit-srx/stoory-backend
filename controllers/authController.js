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
];

module.exports = {
  AuthController: new AuthController(),
  validateSendOTP,
  validateVerifyOTP,
  validateUpdateProfile,
};
