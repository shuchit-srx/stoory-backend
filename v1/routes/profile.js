const express = require("express");
const router = express.Router();
const { ProfileController } = require("../controllers/profileController");
const { validateCompleteProfile } = require("../validators");
const authMiddleware = require("../middleware/authMiddleware");
const { upload } = require("../../utils/imageUpload");

// ============================================
// PROTECTED ROUTES - Profile Management
// ============================================
router.put(
  "/complete",
  authMiddleware.authenticateToken,
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
  ProfileController.completeProfile
);

module.exports = router;

