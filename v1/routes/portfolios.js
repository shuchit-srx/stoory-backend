const express = require("express");
const router = express.Router();
const PortfolioController = require("../controllers/portfolioController");
const authMiddleware = require("../middleware/authMiddleware");
const { normalizeEnums } = require("../middleware/enumNormalizer");
const {
  validateCreatePortfolio,
  validateGetPortfolio,
} = require("../validators/portfolioValidators");
const { uploadPortfolioMedia } = require("../utils/imageUpload");

// All routes require authentication
router.use(authMiddleware.authenticateToken);

/**
 * Create a new portfolio item (Influencer only)
 * POST /api/v1/portfolios
 * Accepts multipart/form-data with optional 'media_file' and 'thumbnail_file' fields
 * OR application/json with 'media_url' and 'thumbnail_url' fields
 */
router.post(
  "/",
  authMiddleware.requireRole(["INFLUENCER"]),
  normalizeEnums,
  // Handle multipart/form-data for file uploads
  (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      // Use fields to accept both media_file and thumbnail_file
      uploadPortfolioMedia.fields([
        { name: "media_file", maxCount: 1 },
        { name: "thumbnail_file", maxCount: 1 }
      ])(req, res, (err) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              success: false,
              message: "File too large. Maximum size is 100MB",
            });
          }
          return res.status(400).json({
            success: false,
            message: err.message || "File upload error",
          });
        }
        next();
      });
    } else {
      // JSON request - continue normally
      next();
    }
  },
  // Validation runs after multer (for JSON fields in multipart)
  validateCreatePortfolio,
  PortfolioController.createPortfolioItem
);

/**
 * Get portfolio items
 * GET /api/v1/portfolios
 * - Influencers: Can see their own portfolio (or filtered by user_id if it's their own)
 * - Brand Owners: Can see all portfolios (can filter by user_id)
 * - Admins: Can see all portfolios (can filter by user_id)
 * Query params: user_id (optional), media_type (optional), page (optional), limit (optional)
 */
router.get(
  "/",
  normalizeEnums,
  validateGetPortfolio,
  PortfolioController.getPortfolioItems
);

module.exports = router;

