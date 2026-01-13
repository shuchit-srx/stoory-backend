const express = require("express");
const router = express.Router();
const SubscriptionController = require("../controllers/subscriptionController");
const authMiddleware = require("../middleware/authMiddleware");
const {
  validateCreateSubscription,
  validateSubscriptionPaymentOrder,
  validateVerifySubscriptionPayment,
} = require("../validators/subscriptionValidators");

/**
 * Subscription Routes
 * All routes require authentication
 */

// Create a new subscription (BRAND_OWNER only) - Direct creation (for admin/internal use)
router.post(
  "/create",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("BRAND_OWNER"),
  validateCreateSubscription,
  SubscriptionController.createSubscription
);

// Get subscription status and details (BRAND_OWNER only)
router.get(
  "/status",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("BRAND_OWNER"),
  SubscriptionController.getSubscriptionStatus
);

// Create subscription payment order (BRAND_OWNER only)
// Brand owner pays admin for subscription
router.post(
  "/payment/order",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("BRAND_OWNER"),
  validateSubscriptionPaymentOrder,
  SubscriptionController.createSubscriptionPaymentOrder
);

// Verify subscription payment and create subscription (BRAND_OWNER only)
// Brand owner pays admin for subscription
router.post(
  "/payment/verify",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("BRAND_OWNER"),
  validateVerifySubscriptionPayment,
  SubscriptionController.verifySubscriptionPayment
);

module.exports = router;

