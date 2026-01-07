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

// Get all influencers (BRAND_OWNER only)
router.get(
  "/influencers/all",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("BRAND_OWNER"),
  UserController.getInfluencers
);

module.exports = router;

