const express = require("express");
const router = express.Router();
const CampaignController = require("../controllers/campaignController");
const authMiddleware = require("../middleware/authMiddleware");
const { normalizeEnums } = require("../middleware/enumNormalizer");
const {
  validateCreateCampaign,
  validateUpdateCampaign,
  validateCampaignFilters,
} = require("../validators/campaignValidators");
const { upload } = require("../utils/imageUpload");

// ============================================
// PROTECTED ROUTES - Campaign Management
// ============================================

// All routes require authentication
router.use(authMiddleware.authenticateToken);

/**
 * Create a new campaign (Brand Owner only)
 * POST /api/v1/campaigns
 * Accepts multipart/form-data with optional 'coverImage' file field
 */
router.post(
  "/",
  authMiddleware.requireRole(["BRAND_OWNER"]),
  normalizeEnums,
  (req, res, next) => {
    upload.single("coverImage")(req, res, (err) => {
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
  },
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
  normalizeEnums,
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
  authMiddleware.requireRole(["BRAND_OWNER"]),
  normalizeEnums,
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
 * Accepts multipart/form-data with optional 'coverImage' file field
 */
router.put(
  "/:id",
  authMiddleware.requireRole(["BRAND_OWNER"]),
  normalizeEnums,
  (req, res, next) => {
    upload.single("coverImage")(req, res, (err) => {
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
  },
  validateUpdateCampaign,
  CampaignController.updateCampaign
);

/**
 * Delete campaign (Brand Owner only)
 * DELETE /api/v1/campaigns/:id
 */
router.delete(
  "/:id",
  authMiddleware.requireRole(["BRAND_OWNER"]),
  CampaignController.deleteCampaign
);

module.exports = router;