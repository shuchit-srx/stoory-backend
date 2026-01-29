const express = require("express");
const router = express.Router();
const UserController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");

/**
 * User Routes
 * All routes require authentication
 */

// Get current user details with all related data
router.get(
  "/me",
  authMiddleware.authenticateToken,
  UserController.getUser
);

// Soft delete current user account
router.delete(
  "/delete-me",
  authMiddleware.authenticateToken,
  UserController.deleteUser
);

// Get influencers - handles both all influencers and single influencer by ID (BRAND_OWNER only)
// GET /influencers/all - Returns all influencers with pagination
// GET /influencers/:id - Returns a single influencer by ID
router.get(
  "/influencers/:id",  // or /influencers/all for all influencers
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("BRAND_OWNER"),
  UserController.getInfluencers
);

module.exports = router;

