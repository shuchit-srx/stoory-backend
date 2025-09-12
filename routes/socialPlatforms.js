const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const {
  SocialPlatformController,
  validateSocialPlatform,
  validateSocialPlatformUpdate,
} = require("../controllers/socialPlatformController");

// Protect all social platform routes
router.use(authService.authenticateToken);

// Social platform management routes
router.get("/", SocialPlatformController.getSocialPlatforms);
router.post(
  "/",
  validateSocialPlatform,
  SocialPlatformController.addSocialPlatform
);
router.put(
  "/:id",
  validateSocialPlatformUpdate,
  SocialPlatformController.updateSocialPlatform
);
router.delete("/:id", SocialPlatformController.deleteSocialPlatform);
router.get("/stats", SocialPlatformController.getSocialPlatformStats);

module.exports = router;
