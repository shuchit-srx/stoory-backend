const { validationResult } = require("express-validator");
const { AuthService } = require("../services");
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
