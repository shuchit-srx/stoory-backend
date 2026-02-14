const express = require("express");
const router = express.Router();
const { ProfileController } = require("../controllers/profileController");
const { validateCompleteProfile } = require("../validators");
const authMiddleware = require("../middleware/authMiddleware");
const { normalizeEnums } = require("../middleware/enumNormalizer");
const { upload } = require("../../utils/imageUpload");

// Single endpoint for updating profile based on user role
router.put(
  "/update",
  authMiddleware.authenticateToken,
  normalizeEnums,
  // Handle multipart/form-data for profile image (influencers) or brand logo (brands)
  (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      // Use fields to accept both profileImage and brandLogo
      upload.fields([
        { name: "profileImage", maxCount: 1 },
        { name: "brandLogo", maxCount: 1 }
      ])(req, res, (err) => {
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
    } else {
      // JSON request - continue normally
      next();
    }
  },
  // Validation runs after multer (for JSON fields in multipart)
  validateCompleteProfile,
  ProfileController.updateProfile
);

/**
 * Get profile completion steps
 * GET /api/v1/profile/completion-steps
 */
router.get(
  "/completion-steps",
  authMiddleware.authenticateToken,
  ProfileController.getProfileCompletionSteps
);

/**
 * Delete (soft delete) a social account
 * DELETE /api/v1/profile/social-accounts/:socialAccountId
 */
router.delete(
  "/social-accounts/:socialAccountId",
  authMiddleware.authenticateToken,
  ProfileController.deleteSocialAccount
);

module.exports = router;
