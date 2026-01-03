const express = require("express");
const router = express.Router();
const PlanController = require("../controllers/planController");
const authMiddleware = require("../middleware/authMiddleware");
const { validateCreatePlan, validateUpdatePlan } = require("../validators/planValidators");

/**
 * Plan Routes
 * All routes require authentication
 */

// Get all active plans (Brand and Admin)
router.get(
  "/",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole(["BRAND", "ADMIN"]),
  PlanController.getAllPlans
);

// Create a new plan (Admin only)
router.post(
  "/",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("ADMIN"),
  validateCreatePlan,
  PlanController.createPlan
);

// Update a plan (Admin only)
router.put(
  "/:id",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("ADMIN"),
  validateUpdatePlan,
  PlanController.updatePlan
);

module.exports = router;

