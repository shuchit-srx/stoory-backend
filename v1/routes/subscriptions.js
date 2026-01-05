const express = require("express");
const router = express.Router();
const SubscriptionController = require("../controllers/subscriptionController");
const authMiddleware = require("../middleware/authMiddleware");

/**
 * Subscription Routes
 * All routes require authentication
 */

// Create a new subscription for authenticated brand user (Brand only)
router.post(
  "/",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("BRAND_OWNER"),
  SubscriptionController.createSubscription
);

// Get all subscriptions (Admin only)
router.get(
  "/all",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("ADMIN"),
  SubscriptionController.getAllSubscriptions
);

// Get current subscription for any brand (Admin only)
router.get(
  "/current/:userId",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("ADMIN"),
  SubscriptionController.getCurrentSubscription
);

// Cancel subscription for authenticated brand user (Brand only)
router.delete(
  "/",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("BRAND_OWNER"),
  SubscriptionController.cancelSubscription
);

// Cancel subscription for any brand (Admin only)
router.delete(
  "/:userId",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("ADMIN"),
  SubscriptionController.cancelSubscriptionForBrand
);

module.exports = router;

