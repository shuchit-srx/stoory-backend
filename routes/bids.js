const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const { upload } = require("../utils/imageUpload");
const {
  BidController,
  validateCreateBid,
  validateUpdateBid,
} = require("../controllers/bidController");

// All routes require authentication
router.use(authService.authenticateToken);

// Bid CRUD operations
router.post(
  "/",
  authService.requireRole(["brand_owner", "admin"]),
  upload.single("image"),
  validateCreateBid,
  BidController.createBid
);
router.get("/", BidController.getBids);
router.get("/stats", BidController.getBidStats);
router.get("/:id", BidController.getBid);
router.put(
  "/:id",
  authService.requireRole(["brand_owner", "admin"]),
  upload.single("image"),
  validateUpdateBid,
  BidController.updateBid
);
router.delete(
  "/:id",
  authService.requireRole(["brand_owner", "admin"]),
  BidController.deleteBid
);

// Automated Flow Routes
router.post(
  "/automated/initialize",
  authService.requireRole(["brand_owner", "admin"]),
  BidController.initializeBidConversation
);
router.post(
  "/automated/brand-owner-action",
  authService.requireRole(["brand_owner", "admin"]),
  BidController.handleBrandOwnerAction
);
router.post(
  "/automated/influencer-action",
  authService.requireRole(["influencer"]),
  BidController.handleInfluencerAction
);
router.post(
  "/automated/final-confirmation",
  authService.requireRole(["brand_owner", "admin"]),
  BidController.handleFinalConfirmation
);
router.get(
  "/automated/conversation/:conversation_id/context",
  BidController.getConversationFlowContext
);

module.exports = router;
