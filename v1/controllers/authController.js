const { validationResult } = require("express-validator");
const AuthService = require("../services/authService");
const validators = require("../validators");

class AuthController {
  async sendOTP(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { phone } = req.body;
      const result = await AuthService.sendOTP(phone);

      if (result.success) {
        return res.json({
          success: true,
          message: result.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error("[v1/sendOTP] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async sendRegistrationOTP(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { phone } = req.body;
      const result = await AuthService.sendRegistrationOTP(phone);

      if (result.success) {
        return res.json({
          success: true,
          message: result.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error("[v1/sendRegistrationOTP] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async verifyOTP(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { phone, token, userData } = req.body;

      console.log("[v1/verifyOTP] Request:", {
        phone,
        token: token ? "***" : "missing",
        userData: userData ? "provided" : "not provided",
      });

      const result = await AuthService.verifyOTP(phone, token, userData);

      if (result.success) {
        return res.json({
          success: true,
          user: result.user,
          token: result.token,
          refreshToken: result.refreshToken,
          message: result.message || "Authentication successful",
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
      });
    } catch (err) {
      console.error("[v1/verifyOTP] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: "Refresh token is required",
          code: "REFRESH_TOKEN_REQUIRED",
        });
      }

      const result = await AuthService.refreshToken(refreshToken);

      if (result.success) {
        return res.json({
          success: true,
          data: {
            token: result.token,
            refreshToken: result.refreshToken,
          },
        });
      }

      const status =
        result.code === "REFRESH_TOKEN_EXPIRED" ||
        result.code === "INVALID_TOKEN_TYPE"
          ? 401
          : 400;

      return res.status(status).json({
        success: false,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error("[v1/refreshToken] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async uploadProfileImage(req, res) {
    try {
      // Handle multer errors (file size, etc.)
      if (req.file === undefined && req.body) {
        // Check if it's a multer error
        if (req.body.error) {
          return res.status(400).json({
            success: false,
            message: req.body.error,
          });
        }
      }

      // Check for multer file size error
      if (req.file === undefined) {
        // This might be a multer error - check error in request
        return res.status(400).json({
          success: false,
          message: "No image file provided or file too large (max 5MB)",
        });
      }

      const userId = req.user.id;

      const result = await AuthService.uploadProfileImage(
        userId,
        req.file.buffer,
        req.file.originalname
      );

      if (result.success) {
        return res.json({
          success: true,
          user: { id: userId },
          profile_image_url: result.profile_image_url,
          message: result.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        error: result.error,
      });
    } catch (err) {
      console.error("[v1/uploadProfileImage] error:", err);

      // Handle multer errors specifically
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File too large. Maximum size is 5MB",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

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

      // If multipart, parse JSON fields from req.body (multer adds them as strings)
      if (req.file) {
        // Brand logo file uploaded
        bodyData = {
          ...bodyData,
          brand_logo_file: req.file, // Pass file object to service
        };
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

      const {
        pan_number,
        upi_id, // Note: Not in schema yet, but accepting for future use
        social_platforms,
        languages,
        categories,
        // Brand-specific fields
        brand_name,
        bio,
        brand_logo_file, // File object from multer
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
        // Influencer-specific fields
        if (languages && Array.isArray(languages) && languages.length > 0) {
          profileData.primary_language = languages[0];
        }
        if (social_platforms !== undefined) {
          profileData.social_platforms = social_platforms;
        }
        if (categories !== undefined) {
          profileData.categories = categories;
        }
      } else if (userRole === "BRAND") {
        // Brand-specific fields
        if (brand_name !== undefined) {
          profileData.brand_name = brand_name;
        }
        if (bio !== undefined) {
          profileData.bio = bio;
        }
        if (brand_logo_file) {
          profileData.brand_logo_file = brand_logo_file;
        }
      }

      // Debug: Log what we're sending to service
      console.log("[v1/completeProfile] Sending to service:", {
        pan_number: profileData.pan_number,
        brand_name: profileData.brand_name,
        bio: profileData.bio,
        hasLogoFile: !!profileData.brand_logo_file,
      });

      const result = await AuthService.completeProfile(
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
        } else if (userRole === "BRAND") {
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

  // ============================================
  // PASSWORD AUTHENTICATION (Brand Owners)
  // ============================================

  async registerBrandOwner(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, name } = req.body;

      const result = await AuthService.registerBrandOwner(
        email,
        password,
        name
      );

      if (result.success) {
        return res.status(201).json({
          success: true,
          user: result.user,
          // Only return token in development
          ...(result.verification_token && {
            verification_token: result.verification_token,
          }),
          message: result.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error("[v1/registerBrandOwner] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async loginBrandOwner(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      const result = await AuthService.loginBrandOwner(email, password);

      if (result.success) {
        return res.json({
          success: true,
          user: result.user,
          token: result.token,
          refreshToken: result.refreshToken,
          message: result.message,
        });
      }

      const status = result.code === "INVALID_CREDENTIALS" ? 401 : 400;

      return res.status(status).json({
        success: false,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error("[v1/loginBrandOwner] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async verifyEmail(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { token } = req.body;

      const result = await AuthService.verifyEmail(token);

      if (result.success) {
        return res.json({
          success: true,
          message: result.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error("[v1/verifyEmail] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async resendEmailVerification(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email } = req.body;

      const result = await AuthService.resendEmailVerification(email);

      if (result.success) {
        return res.json({
          success: true,
          message: result.message,
          // Only return token in development
          ...(result.verification_token && {
            verification_token: result.verification_token,
          }),
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error("[v1/resendEmailVerification] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async forgotPassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email } = req.body;

      const result = await AuthService.forgotPassword(email);

      if (result.success) {
        return res.json({
          success: true,
          message: result.message,
          // Only return token in development
          ...(result.reset_token && { reset_token: result.reset_token }),
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message,
      });
    } catch (err) {
      console.error("[v1/forgotPassword] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async resetPassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { token, new_password } = req.body;

      const result = await AuthService.resetPassword(token, new_password);

      if (result.success) {
        return res.json({
          success: true,
          message: result.message,
        });
      }

      const status = result.code === "INVALID_TOKEN" ? 400 : 400;

      return res.status(status).json({
        success: false,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error("[v1/resetPassword] error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
}

module.exports = {
  AuthController: new AuthController(),
  // Export validators from validators folder
  ...validators,
};
