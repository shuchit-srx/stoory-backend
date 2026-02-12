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
const { upload, uploadBulkCampaignFiles } = require("../utils/imageUpload");

// ============================================
// PROTECTED ROUTES - Campaign Management
// ============================================

// All routes require authentication
router.use(authMiddleware.authenticateToken);

/**
 * Create a new campaign (Brand Owner only)
 * POST /api/v1/campaigns/create
 * Accepts multipart/form-data with:
 * - Optional 'coverImage' file field (single file)
 * - Optional 'assets' file field (multiple files, only for BULK campaigns)
 */
router.post(
  "/create",
  authMiddleware.requireRole(["BRAND_OWNER"]),
  normalizeEnums,
  (req, res, next) => {
    // Use fields to handle both single coverImage and multiple assets
    uploadBulkCampaignFiles.fields([
      { name: 'coverImage', maxCount: 1 },
      { name: 'assets', maxCount: 20 },
    ])(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "File too large. Maximum size is 50MB",
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || "File upload error",
        });
      }
      
      // Convert fields to single file for coverImage (for backward compatibility)
      if (req.files && req.files.coverImage && req.files.coverImage.length > 0) {
        req.file = req.files.coverImage[0];
      }
      
      // Flatten assets files array
      if (req.files) {
        const assetsFiles = [
          ...(req.files.assets || []),
        ];
        req.files = assetsFiles;
      }
      
      next();
    });
  },
  validateCreateCampaign,
  CampaignController.createCampaign
);

/**
 * Get all campaigns with filtering and pagination
 * GET /api/v1/campaigns/all
 * - Influencers: See all campaigns
 * - Brand Owners: See all campaigns
 */
router.get(
  "/all",
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
 * Accepts multipart/form-data with:
 * - Optional 'coverImage' file field (single file)
 * - Optional 'assets' file field (multiple files, only for BULK campaigns)
 */
router.put(
  "/:id",
  authMiddleware.requireRole(["BRAND_OWNER"]),
  normalizeEnums,
  (req, res, next) => {
    // Use fields to handle both single coverImage and multiple assets
    uploadBulkCampaignFiles.fields([
      { name: 'coverImage', maxCount: 1 },
      { name: 'assets', maxCount: 20 },
    ])(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "File too large. Maximum size is 50MB",
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || "File upload error",
        });
      }
      
      // Convert fields to single file for coverImage (for backward compatibility)
      if (req.files && req.files.coverImage && req.files.coverImage.length > 0) {
        req.file = req.files.coverImage[0];
      }
      
      // Flatten assets files array
      if (req.files) {
        const assetsFiles = [
          ...(req.files.assets || []),
        ];
        req.files = assetsFiles;
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