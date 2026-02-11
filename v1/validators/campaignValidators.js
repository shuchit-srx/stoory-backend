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
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["NORMAL", "BULK"];
      if (!validValues.includes(normalized)) {
        throw new Error("Type must be NORMAL or BULK");
      }
      return true;
    }),
  body("status")
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["DRAFT", "LIVE", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
      if (!validValues.includes(normalized)) {
        throw new Error("Invalid status. Must be one of: DRAFT, LIVE, IN_PROGRESS, COMPLETED, CANCELLED");
      }
      return true;
    }),
  body("requires_script")
    .optional()
    .isBoolean()
    .withMessage("requires_script must be a boolean"),
  body("budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("budget must be a non-negative number"),
  // New fields
  body("description")
    .optional()
    .isString()
    .isLength({ max: 5000 })
    .withMessage("Description must be up to 5000 characters")
    .trim(),
  body("platform")
    .optional()
    .isArray()
    .withMessage("platform must be an array"),
  body("platform.*")
    .optional()
    .isString()
    .withMessage("Each platform must be a string"),
  body("content_type")
    .optional()
    .isArray()
    .withMessage("content_type must be an array"),
  body("content_type.*")
    .optional()
    .isString()
    .withMessage("Each content_type must be a string"),
  body("influencer_tier")
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["NANO", "MICRO", "MID", "MACRO"];
      if (!validValues.includes(normalized)) {
        throw new Error("influencer_tier must be NANO, MICRO, MID, or MACRO");
      }
      return true;
    }),
  body("categories")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("categories must be up to 500 characters")
    .trim(),
  body("language")
    .optional()
    .isString()
    .isLength({ max: 50 })
    .withMessage("language must be up to 50 characters")
    .trim(),
  body("brand_guideline")
    .optional()
    .isString()
    .isLength({ max: 10000 })
    .withMessage("brand_guideline must be up to 10000 characters")
    .trim(),
  body("work_deadline")
    .optional()
    .isISO8601()
    .withMessage("work_deadline must be a valid ISO 8601 date")
    .toDate(),
  body("script_deadline")
    .optional()
    .isISO8601()
    .withMessage("script_deadline must be a valid ISO 8601 date")
    .toDate(),
  body("applications_accepted_till")
    .optional()
    .isISO8601()
    .withMessage("applications_accepted_till must be a valid ISO 8601 date")
    .toDate(),
  body("buffer_days")
    .optional()
    .isInt({ min: 0 })
    .withMessage("buffer_days must be a non-negative integer"),
  // BULK campaign specific fields
  body("campaign_assets")
    .optional()
    .isArray()
    .withMessage("campaign_assets must be an array"),
  body("campaign_assets.*")
    .optional()
    .isString()
    .isURL()
    .withMessage("Each campaign_assets item must be a valid URL"),
  body("additional_requirements")
    .optional()
    .isString()
    .isLength({ max: 10000 })
    .withMessage("additional_requirements must be up to 10000 characters")
    .trim(),
  // Custom validation
  body().custom((value) => {
    // Validate that applications_accepted_till <= work_deadline if both are provided
    if (
      value.applications_accepted_till !== undefined &&
      value.work_deadline !== undefined &&
      value.applications_accepted_till &&
      value.work_deadline
    ) {
      const acceptingDate = new Date(value.applications_accepted_till);
      const workDate = new Date(value.work_deadline);
      if (acceptingDate > workDate) {
        throw new Error(
          "applications_accepted_till must be less than or equal to work_deadline"
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
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["NORMAL", "BULK"];
      if (!validValues.includes(normalized)) {
        throw new Error("Type must be NORMAL or BULK");
      }
      return true;
    }),
  body("status")
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["DRAFT", "LIVE", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
      if (!validValues.includes(normalized)) {
        throw new Error("Invalid status. Must be one of: DRAFT, LIVE, IN_PROGRESS, COMPLETED, CANCELLED");
      }
      return true;
    }),
  body("requires_script")
    .optional()
    .isBoolean()
    .withMessage("requires_script must be a boolean"),
  body("budget")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("budget must be a non-negative number"),
  // New fields
  body("description")
    .optional()
    .isString()
    .isLength({ max: 5000 })
    .withMessage("Description must be up to 5000 characters")
    .trim(),
  body("platform")
    .optional()
    .isArray()
    .withMessage("platform must be an array"),
  body("platform.*")
    .optional()
    .isString()
    .withMessage("Each platform must be a string"),
  body("content_type")
    .optional()
    .isArray()
    .withMessage("content_type must be an array"),
  body("content_type.*")
    .optional()
    .isString()
    .withMessage("Each content_type must be a string"),
  body("influencer_tier")
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["NANO", "MICRO", "MID", "MACRO"];
      if (!validValues.includes(normalized)) {
        throw new Error("influencer_tier must be NANO, MICRO, MID, or MACRO");
      }
      return true;
    }),
  body("categories")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("categories must be up to 500 characters")
    .trim(),
  body("language")
    .optional()
    .isString()
    .isLength({ max: 50 })
    .withMessage("language must be up to 50 characters")
    .trim(),
  body("brand_guideline")
    .optional()
    .isString()
    .isLength({ max: 10000 })
    .withMessage("brand_guideline must be up to 10000 characters")
    .trim(),
  body("work_deadline")
    .optional()
    .isISO8601()
    .withMessage("work_deadline must be a valid ISO 8601 date")
    .toDate(),
  body("script_deadline")
    .optional()
    .isISO8601()
    .withMessage("script_deadline must be a valid ISO 8601 date")
    .toDate(),
  body("applications_accepted_till")
    .optional()
    .isISO8601()
    .withMessage("applications_accepted_till must be a valid ISO 8601 date")
    .toDate(),
  body("buffer_days")
    .optional()
    .isInt({ min: 0 })
    .withMessage("buffer_days must be a non-negative integer"),
  // BULK campaign specific fields
  body("campaign_assets")
    .optional()
    .isArray()
    .withMessage("campaign_assets must be an array"),
  body("campaign_assets.*")
    .optional()
    .isString()
    .isURL()
    .withMessage("Each campaign_assets item must be a valid URL"),
  body("additional_requirements")
    .optional()
    .isString()
    .isLength({ max: 10000 })
    .withMessage("additional_requirements must be up to 10000 characters")
    .trim(),
  // Custom validation
  body().custom((value) => {
    // Validate that applications_accepted_till <= work_deadline if both are provided
    if (
      value.applications_accepted_till !== undefined &&
      value.work_deadline !== undefined &&
      value.applications_accepted_till &&
      value.work_deadline
    ) {
      const acceptingDate = new Date(value.applications_accepted_till);
      const workDate = new Date(value.work_deadline);
      if (acceptingDate > workDate) {
        throw new Error(
          "applications_accepted_till must be less than or equal to work_deadline"
        );
      }
    }
    return true;
  }),
];

const validateCampaignFilters = [
  query("status")
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["DRAFT", "LIVE", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
      if (!validValues.includes(normalized)) {
        throw new Error("Invalid status filter. Must be one of: DRAFT, LIVE, IN_PROGRESS, COMPLETED, CANCELLED");
      }
      return true;
    }),
  query("type")
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["NORMAL", "BULK"];
      if (!validValues.includes(normalized)) {
        throw new Error("Invalid type filter. Must be NORMAL or BULK");
      }
      return true;
    }),
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