const router = require("express").Router();
const reportController = require("../controllers/reportController");
const authMiddleware = require("../middleware/authMiddleware");
const {
  validateCreateReport,
  validateGetReportById,
  validateUpdateReport,
  validateGetAllReports,
  validateGetPendingReports,
} = require("../validators/reportValidators");

/**
 * Create a new report
 * POST /api/v1/reports/create
 * Authentication: Required (Brand Owner or Influencer)
 */
router.post(
  "/create",
  authMiddleware.authenticateToken,
  validateCreateReport,
  reportController.createReport
);

/**
 * Get all reports with filtering and pagination
 * GET /api/v1/reports/get/all
 * Authentication: Required
 */
router.get(
  "/get/all",
  authMiddleware.authenticateToken,
  validateGetAllReports,
  reportController.getAllReports
);

/**
 * Get all pending reports (Admin only)
 * GET /api/v1/reports/get/pending
 * Authentication: Required (Admin only)
 */
router.get(
  "/get/pending",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("ADMIN"),
  validateGetPendingReports,
  reportController.getPendingReports
);

/**
 * Get a single report by ID
 * GET /api/v1/reports/get/:id
 * Authentication: Required
 */
router.get(
  "/get/:id",
  authMiddleware.authenticateToken,
  validateGetReportById,
  reportController.getReportById
);

/**
 * Update a report (Admin only)
 * PUT /api/v1/reports/update/:id
 * Authentication: Required (Admin only)
 */
router.put(
  "/update/:id",
  authMiddleware.authenticateToken,
  authMiddleware.requireRole("ADMIN"),
  validateUpdateReport,
  reportController.updateReport
);

module.exports = router;

