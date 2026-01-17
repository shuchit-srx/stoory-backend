const express = require("express");
const router = express.Router();
const { AuthController } = require("../controllers/authController");
const {
  validateSendOTP,
  validateVerifyOTP,
  validateBrandRegister,
  validateBrandLogin,
  validateEmailVerification,
  validateResendEmailVerification,
  validateForgotPassword,
  validateResetPassword,
  validateVerifyPAN,
} = require("../validators");
const AuthService = require("../services/authService");
const authMiddleware = require("../middleware/authMiddleware");
const { normalizeEnums } = require("../middleware/enumNormalizer");

// Backward compatibility: redirect old profile route to new profile controller
const { ProfileController } = require("../controllers/profileController");
const { validateCompleteProfile } = require("../validators");
const { upload } = require("../../utils/imageUpload");

// ============================================
// PUBLIC ROUTES - OTP Authentication (Influencers)
// ============================================
router.post("/send-otp", normalizeEnums, validateSendOTP, AuthController.sendOTP);
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
// PAN VERIFICATION (Public - Optional Auth)
// ============================================
// PAN verification (works with or without authentication)
// If authenticated: checks if already verified, saves verification status to profile
// If not authenticated: just returns verification result
router.post(
  "/verify-pan",
  authMiddleware.authenticateTokenOptional,
  validateVerifyPAN,
  AuthController.verifyPAN
);

module.exports = router;
