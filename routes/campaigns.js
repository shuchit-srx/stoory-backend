const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const { upload, uploadBulkCampaignFiles } = require("../utils/imageUpload");
const {
  CampaignController,
  validateCreateCampaign,
  validateUpdateCampaign,
} = require("../controllers/campaignController");
const BulkCampaignController = require("../controllers/bulkCampaignController");

// All routes require authentication
router.use(authService.authenticateToken);

// Campaign CRUD operations
router.post(
  "/",
  authService.requireRole(["brand_owner", "admin"]),
  upload.single("image"),
  validateCreateCampaign,
  CampaignController.createCampaign
);
// Middleware to parse nested form data (e.g., tierPrices[Nano (1K-10K)])
const parseNestedFormData = (req, res, next) => {
  const tierPrices = {};
  const tierMaxCreators = {};
  
  Object.keys(req.body).forEach((key) => {
    const tierPriceMatch = key.match(/^tierPrices\[(.+)\]$/);
    if (tierPriceMatch) {
      const tierName = tierPriceMatch[1];
      tierPrices[tierName] = req.body[key];
      delete req.body[key];
    }
    
    const tierMaxMatch = key.match(/^tierMaxCreators\[(.+)\]$/);
    if (tierMaxMatch) {
      const tierName = tierMaxMatch[1];
      tierMaxCreators[tierName] = req.body[key];
      delete req.body[key];
    }
  });
  
  if (Object.keys(tierPrices).length > 0) {
    req.body.tierPrices = tierPrices;
  }
  if (Object.keys(tierMaxCreators).length > 0) {
    req.body.tierMaxCreators = tierMaxCreators;
  }
  
  // Parse array fields
  ['deliverables', 'categories', 'languages', 'links'].forEach((field) => {
    if (req.body[field] && !Array.isArray(req.body[field])) {
      req.body[field] = [req.body[field]];
    }
  });
  
  next();
};

// Bulk campaign creation route
router.post(
  "/bulk",
  authService.requireRole(["brand_owner", "admin"]),
  uploadBulkCampaignFiles.array("referenceFiles", 10),
  parseNestedFormData,
  BulkCampaignController.createBulkCampaign
);

router.get("/", (req, res, next) => {
  if (req.query.type === 'BULK') {
    return BulkCampaignController.getBulkCampaigns(req, res);
  }
  return CampaignController.getCampaigns(req, res);
});
router.get("/stats", CampaignController.getCampaignStats);
router.get("/:id", CampaignController.getCampaign);
router.put(
  "/:id",
  authService.requireRole(["brand_owner", "admin"]),
  upload.single("image"),
  validateUpdateCampaign,
  CampaignController.updateCampaign
);
router.delete(
  "/:id",
  authService.requireRole(["brand_owner", "admin"]),
  CampaignController.deleteCampaign
);

// Automated conversation routes
router.post(
  "/automated/initialize",
  authService.requireRole(["brand_owner"]),
  CampaignController.initializeCampaignConversation
);
router.post(
  "/automated/influencer-action",
  authService.requireRole(["influencer"]),
  CampaignController.handleCampaignInfluencerAction
);
router.post(
  "/automated/brand-owner-action",
  authService.requireRole(["brand_owner"]),
  CampaignController.handleCampaignBrandOwnerAction
);
router.post(
  "/:conversation_id/automated/submit-work",
  authService.requireRole(["influencer"]),
  CampaignController.handleWorkSubmission
);
router.post(
  "/:conversation_id/automated/review-work",
  authService.requireRole(["brand_owner"]),
  CampaignController.handleWorkReview
);

// Payment verification route
router.post(
  "/automated/verify-payment",
  CampaignController.verifyAutomatedFlowPayment
);

module.exports = router;
