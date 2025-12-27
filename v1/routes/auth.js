const express = require("express");
const router = express.Router();
const { AuthController } = require("../controllers/authController");
const {
  validateSendOTP,
  validateVerifyOTP,
  validateCompleteProfile,
  validateBrandRegister,
  validateBrandLogin,
  validateEmailVerification,
  validateResendEmailVerification,
  validateForgotPassword,
  validateResetPassword,
} = require("../validators");
const AuthService = require("../services/authService");
const authMiddleware = require("../middleware/authMiddleware");
const { upload } = require("../../utils/imageUpload");

// ============================================
// PUBLIC ROUTES - OTP Authentication (Influencers)
// ============================================
router.post("/send-otp", validateSendOTP, AuthController.sendOTP);
router.post(
  "/send-registration-otp",
  validateSendOTP,
  AuthController.sendRegistrationOTP
);
router.post("/verify-otp", validateVerifyOTP, AuthController.verifyOTP);
router.post("/refresh-token", AuthController.refreshToken);

// WhatsApp service status (reuses utils/whatsapp)
router.get("/whatsapp-status", (req, res) => {
  const status = AuthService.getWhatsAppStatus();
  res.json({ success: true, whatsapp: status });
});

// ============================================
// PUBLIC ROUTES - Password Authentication (Brand Owners)
// ============================================
router.post(
  "/brand/register",
  validateBrandRegister,
  AuthController.registerBrandOwner
);

router.post("/brand/login", validateBrandLogin, AuthController.loginBrandOwner);

router.post(
  "/brand/verify-email",
  validateEmailVerification,
  AuthController.verifyEmail
);

router.post(
  "/brand/resend-verification",
  validateResendEmailVerification,
  AuthController.resendEmailVerification
);

router.post(
  "/brand/forgot-password",
  validateForgotPassword,
  AuthController.forgotPassword
);

router.post(
  "/brand/reset-password",
  validateResetPassword,
  AuthController.resetPassword
);

// ============================================
// PROTECTED ROUTES - Profile Management
// ============================================
router.post(
  "/profile/image",
  authMiddleware.authenticateToken,
  (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (err) {
        // Handle multer errors
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "File too large. Maximum size is 5MB",
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || "File upload error",
        });
      }
      next();
    });
  },
  AuthController.uploadProfileImage
);

router.put(
  "/profile/complete",
  authMiddleware.authenticateToken,
  // Handle multipart/form-data for brand logo upload (before validation)
  (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      upload.single("brand_logo")(req, res, (err) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              success: false,
              message: "File too large. Maximum size is 5MB",
            });
          }
          return res.status(400).json({
            success: false,
            message: err.message || "File upload error",
          });
        }
        next();
      });
    } else {
      // JSON request - continue normally
      next();
    }
  },
  // Validation runs after multer (for JSON fields in multipart)
  validateCompleteProfile,
  AuthController.completeProfile
);

module.exports = router;
