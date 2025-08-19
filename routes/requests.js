const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const {
  RequestController,
  validateCreateRequest,
  validateUpdateRequestStatus,
} = require("../controllers/requestController");
const { body } = require("express-validator");

// All routes require authentication
router.use(authService.authenticateToken);

// Request operations
router.post(
  "/",
  authService.requireRole("influencer"),
  validateCreateRequest,
  RequestController.createRequest
);
router.get("/", RequestController.getRequests);
router.get("/:id", RequestController.getRequest);
router.put(
  "/:id/status",
  authService.requireRole(["brand_owner", "admin"]),
  validateUpdateRequestStatus,
  RequestController.updateRequestStatus
);
router.put(
  "/:id/agree",
  authService.requireRole("influencer"),
  RequestController.updateAgreedAmount
);
router.delete(
  "/:id",
  authService.requireRole("influencer"),
  RequestController.withdrawRequest
);

// Payment routes
router.post(
  "/approval-payment",
  authService.requireRole(["brand_owner", "admin"]),
  RequestController.processApprovalPayment
);
router.post(
  "/completion-payment",
  authService.requireRole(["brand_owner", "admin"]),
  RequestController.processCompletionPayment
);

// Influencer list routes for bids and campaigns
router.get("/bid/:bid_id/influencers", RequestController.getBidInfluencers);
router.get(
  "/campaign/:campaign_id/influencers",
  RequestController.getCampaignInfluencers
);
router.get(
  "/bid/:bid_id/influencer-count",
  RequestController.getBidInfluencerCount
);
router.get(
  "/campaign/:campaign_id/influencer-count",
  RequestController.getCampaignInfluencerCount
);

// New escrow and work management routes
router.post(
  "/:id/finalize-agreement",
  [
    body("final_agreed_amount")
      .isNumeric()
      .withMessage("Final agreed amount must be a number"),
    body("max_revokes")
      .optional()
      .isInt({ min: 1, max: 10 })
      .withMessage("Max revokes must be between 1 and 10"),
  ],
  RequestController.finalizeAgreement
);

router.post(
  "/:id/submit-work",
  [
    body("work_submission_link")
      .optional()
      .isURL()
      .withMessage("Work submission link must be a valid URL"),
    body("work_description")
      .optional()
      .isString()
      .withMessage("Work description must be a string"),
    body("work_files")
      .optional()
      .isArray()
      .withMessage("Work files must be an array"),
  ],
  RequestController.submitWork
);

router.post("/:id/approve-work", RequestController.approveWork);

router.post(
  "/:id/request-revision",
  [
    body("revision_reason")
      .optional()
      .isString()
      .withMessage("Revision reason must be a string"),
  ],
  RequestController.requestRevision
);

router.get("/:id/work-status", RequestController.getWorkStatus);

module.exports = router;
