const express = require("express");
const router = express.Router();
const SubscriptionController = require("../controllers/subscriptionController");
const authMiddleware = require("../middleware/authMiddleware");
const { validateCreateSubscription } = require("../validators/subscriptionValidators");

/**
 * Subscription Routes
 * All routes require authentication
 */

// Create a new subscription (BRAND_OWNER only)
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

module.exports = router;

