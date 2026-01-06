const express = require("express");
const router = express.Router();
const PaymentController = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");
const {
  validateApplicationIdParam,
  validateVerifyPayment,
} = require("../validators/paymentValidators");

/**
 * Payment Routes for Applications
 * All routes require authentication
 */

// Get payment config (Razorpay key) - Public for authenticated users
router.get(
  "/config",
  authMiddleware.authenticateToken,
  PaymentController.getPaymentConfig
);

// Create payment order for application (Brand pays admin after application completion)
router.post(
  "/applications/:applicationId",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole(["BRAND_OWNER", "ADMIN"]),
  validateApplicationIdParam,
  PaymentController.createApplicationPaymentOrder
);

// Verify payment (Brand and Admin)
router.post(
  "/verify",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole(["BRAND_OWNER", "ADMIN"]),
  validateVerifyPayment,
  PaymentController.verifyPayment
);

// Release payout to influencer (Admin only)
router.post(
  "/applications/:applicationId/release",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("ADMIN"),
  validateApplicationIdParam,
  PaymentController.releasePayout
);

// Get payments for an application (Brand, Influencer, Admin)
router.get(
  "/applications/:applicationId",
  authMiddleware.authenticateToken,
  validateApplicationIdParam,
  PaymentController.getApplicationPayments
);

module.exports = router;
