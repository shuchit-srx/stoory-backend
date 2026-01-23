const express = require("express");
const router = express.Router();
const PaymentController = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");
const { normalizeEnums } = require("../middleware/enumNormalizer");
const {
  validateApplicationIdParam,
  validateVerifyPayment,
  validateCampaignIdParam,
  validateBulkPayment,
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

// Create bulk payment order for campaign (Brand pays admin for selected accepted applications)
router.post(
  "/campaigns/:campaignId/bulk",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole(["BRAND_OWNER", "ADMIN"]),
  validateCampaignIdParam,
  validateBulkPayment,
  PaymentController.createCampaignBulkPaymentOrder
);

// Verify payment (Brand and Admin)
router.post(
  "/verify",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole(["BRAND_OWNER", "ADMIN"]),
  normalizeEnums,
  validateVerifyPayment,
  PaymentController.verifyPayment
);

// Get payments for an application (Brand, Admin)
router.get(
  "/applications/:applicationId",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole(["BRAND_OWNER", "ADMIN"]),
  validateApplicationIdParam,
  PaymentController.getApplicationPayments
);

// Get transactions for a brand owner
router.get(
  "/transactions/all",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole(["BRAND_OWNER", "ADMIN"]),
  PaymentController.getBrandTransactions
);

module.exports = router;
