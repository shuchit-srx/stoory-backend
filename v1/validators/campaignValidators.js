const { body, query } = require("express-validator");

/**
 * Campaign Validators
 * Validation rules for campaign CRUD operations
 */

const validateCreateCampaign = [
  body("title")
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters")
    .trim(),
  body("type")
    .optional()
    .isIn(["NORMAL", "BULK", "normal", "bulk"])
    .withMessage("Type must be NORMAL or BULK"),
  body("status")
    .optional()
    .isIn([
      "DRAFT",
      "LIVE",
      "LOCKED",
      "ACTIVE",
      "COMPLETED",
      "EXPIRED",
      "CANCELLED",
      "draft",
      "live",
      "locked",
      "active",
      "completed",
      "expired",
      "cancelled",
    ])
    .withMessage("Invalid status"),
  body("min_influencers")
    .optional()
    .isInt({ min: 1 })
    .withMessage("min_influencers must be a positive integer"),
  body("max_influencers")
    .optional()
    .isInt({ min: 1 })
    .withMessage("max_influencers must be a positive integer"),
  body("requires_script")
    .optional()
    .isBoolean()
    .withMessage("requires_script must be a boolean"),
  body("start_deadline")
    .optional()
    .isISO8601()
    .withMessage("start_deadline must be a valid ISO 8601 date")
    .toDate(),
  body("budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("budget must be a non-negative number"),
  // Custom validation: min_influencers <= max_influencers
  body().custom((value) => {
    if (
      value.min_influencers !== undefined &&
      value.max_influencers !== undefined
    ) {
      if (value.min_influencers > value.max_influencers) {
        throw new Error(
          "min_influencers cannot be greater than max_influencers"
        );
      }
    }
    return true;
  }),
];

const validateUpdateCampaign = [
  body("title")
    .optional()
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters")
    .trim(),
  body("type")
    .optional()
    .isIn(["NORMAL", "BULK", "normal", "bulk"])
    .withMessage("Type must be NORMAL or BULK"),
  body("status")
    .optional()
    .isIn([
      "DRAFT",
      "LIVE",
      "LOCKED",
      "ACTIVE",
      "COMPLETED",
      "EXPIRED",
      "CANCELLED",
      "draft",
      "live",
      "locked",
      "active",
      "completed",
      "expired",
      "cancelled",
    ])
    .withMessage("Invalid status"),
  body("min_influencers")
    .optional()
    .isInt({ min: 1 })
    .withMessage("min_influencers must be a positive integer"),
  body("max_influencers")
    .optional()
    .isInt({ min: 1 })
    .withMessage("max_influencers must be a positive integer"),
  body("requires_script")
    .optional()
    .isBoolean()
    .withMessage("requires_script must be a boolean"),
  body("start_deadline")
    .optional()
    .isISO8601()
    .withMessage("start_deadline must be a valid ISO 8601 date")
    .toDate(),
  body("budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("budget must be a non-negative number"),
  // Custom validation: min_influencers <= max_influencers
  body().custom((value) => {
    if (
      value.min_influencers !== undefined &&
      value.max_influencers !== undefined
    ) {
      if (value.min_influencers > value.max_influencers) {
        throw new Error(
          "min_influencers cannot be greater than max_influencers"
        );
      }
    }
    return true;
  }),
];

const validateCampaignFilters = [
  query("status")
    .optional()
    .isIn([
      "DRAFT",
      "LIVE",
      "LOCKED",
      "ACTIVE",
      "COMPLETED",
      "EXPIRED",
      "CANCELLED",
      "draft",
      "live",
      "locked",
      "active",
      "completed",
      "expired",
      "cancelled",
    ])
    .withMessage("Invalid status filter"),
  query("type")
    .optional()
    .isIn(["NORMAL", "BULK", "normal", "bulk"])
    .withMessage("Invalid type filter"),
  query("brand_id")
    .optional()
    .isUUID()
    .withMessage("brand_id must be a valid UUID"),
  query("min_budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("min_budget must be a non-negative number"),
  query("max_budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("max_budget must be a non-negative number"),
  query("search")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Search query must be between 1 and 100 characters"),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page must be a positive integer"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),
];

module.exports = {
  validateCreateCampaign,
  validateUpdateCampaign,
  validateCampaignFilters,
};

