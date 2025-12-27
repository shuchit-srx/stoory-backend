const express = require("express");
const router = express.Router();
const CampaignController = require("../controllers/campaignController");
const authMiddleware = require("../middleware/authMiddleware");
const {
  validateCreateCampaign,
  validateUpdateCampaign,
  validateCampaignFilters,
} = require("../validators/campaignValidators");

// ============================================
// PROTECTED ROUTES - Campaign Management
// ============================================

// All routes require authentication
router.use(authMiddleware.authenticateToken);

/**
 * Create a new campaign (Brand Owner only)
 * POST /api/v1/campaigns
 */
router.post(
  "/",
  authMiddleware.requireRole(["BRAND"]),
  validateCreateCampaign,
  CampaignController.createCampaign
);

/**
 * Get all campaigns with filtering and pagination
 * GET /api/v1/campaigns
 * - Influencers: See all campaigns
 * - Brand Owners: See all campaigns
 */
router.get(
  "/",
  validateCampaignFilters,
  CampaignController.getCampaigns
);

/**
 * Get campaigns created by authenticated brand owner
 * GET /api/v1/campaigns/my
 * (Brand Owner only)
 */
router.get(
  "/my",
  authMiddleware.requireRole(["BRAND"]),
  validateCampaignFilters,
  CampaignController.getMyCampaigns
);

/**
 * Get single campaign by ID
 * GET /api/v1/campaigns/:id
 * (Public for authenticated users)
 */
router.get("/:id", CampaignController.getCampaign);

/**
 * Update campaign (Brand Owner only)
 * PUT /api/v1/campaigns/:id
 */
router.put(
  "/:id",
  authMiddleware.requireRole(["BRAND"]),
  validateUpdateCampaign,
  CampaignController.updateCampaign
);

/**
 * Delete campaign (Brand Owner only)
 * DELETE /api/v1/campaigns/:id
 */
router.delete(
  "/:id",
  authMiddleware.requireRole(["BRAND"]),
  CampaignController.deleteCampaign
);

module.exports = router;

