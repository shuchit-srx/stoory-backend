const { body, param, query } = require("express-validator");

/**
 * Report Validators
 * Validation rules for report operations
 */

const validateCreateReport = [
  body("reported_user_id")
    .notEmpty()
    .withMessage("reported_user_id is required")
    .isUUID()
    .withMessage("reported_user_id must be a valid UUID"),
  body("application_id")
    .notEmpty()
    .withMessage("application_id is required")
    .isUUID()
    .withMessage("application_id must be a valid UUID"),
  body("type")
    .notEmpty()
    .withMessage("type is required")
    .isIn(["BY_BRAND", "BY_INFLUENCER"])
    .withMessage("type must be BY_BRAND or BY_INFLUENCER"),
  body("description")
    .notEmpty()
    .withMessage("description is required")
    .isLength({ min: 10, max: 5000 })
    .withMessage("description must be between 10 and 5000 characters"),
];

const validateGetReportById = [
  param("id")
    .notEmpty()
    .withMessage("Report ID is required")
    .isUUID()
    .withMessage("Report ID must be a valid UUID"),
];

const validateUpdateReport = [
  param("id")
    .notEmpty()
    .withMessage("Report ID is required")
    .isUUID()
    .withMessage("Report ID must be a valid UUID"),
  body("status")
    .optional()
    .isIn(["PENDING", "RESOLVED"])
    .withMessage("status must be PENDING or RESOLVED"),
  body("admin_notes")
    .optional()
    .isLength({ max: 5000 })
    .withMessage("admin_notes must be 5000 characters or less"),
  body().custom((value) => {
    // At least one field must be provided
    if (!value.status && value.admin_notes === undefined) {
      throw new Error("At least one field (status or admin_notes) must be provided");
    }
    return true;
  }),
];

const validateGetAllReports = [
  query("status")
    .optional()
    .isIn(["PENDING", "RESOLVED"])
    .withMessage("status must be PENDING or RESOLVED"),
  query("type")
    .optional()
    .isIn(["BY_BRAND", "BY_INFLUENCER"])
    .withMessage("type must be BY_BRAND or BY_INFLUENCER"),
  query("application_id")
    .optional()
    .isUUID()
    .withMessage("application_id must be a valid UUID"),
  query("reported_user_id")
    .optional()
    .isUUID()
    .withMessage("reported_user_id must be a valid UUID"),
  query("reporter_id")
    .optional()
    .isUUID()
    .withMessage("reporter_id must be a valid UUID"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),
  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("offset must be >= 0"),
];

const validateGetPendingReports = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),
  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("offset must be >= 0"),
];

module.exports = {
  validateCreateReport,
  validateGetReportById,
  validateUpdateReport,
  validateGetAllReports,
  validateGetPendingReports,
};

