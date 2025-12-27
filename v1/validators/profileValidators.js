const { body } = require("express-validator");

/**
 * Profile Management Validators
 * For profile completion endpoints
 */

const validateCompleteProfile = [
  // Common fields
  body("pan_number")
    .optional()
    .isString()
    .isLength({ min: 10, max: 10 })
    .withMessage("PAN number must be 10 characters"),
  body("upi_id")
    .optional()
    .isString()
    .withMessage("UPI ID must be a string"),
  // Influencer-specific fields
  body("social_platforms")
    .optional()
    .isArray()
    .withMessage("Social platforms must be an array"),
  body("social_platforms.*.platform_name")
    .optional()
    .isString()
    .withMessage("Platform name must be a string"),
  body("social_platforms.*.username")
    .optional()
    .isString()
    .withMessage("Username must be a string"),
  body("social_platforms.*.profile_url")
    .optional()
    .isURL()
    .withMessage("Profile URL must be a valid URL"),
  body("social_platforms.*.follower_count")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Follower count must be a non-negative integer"),
  body("social_platforms.*.engagement_rate")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("Engagement rate must be between 0 and 100"),
  body("languages")
    .optional()
    .isArray()
    .withMessage("Languages must be an array"),
  body("categories")
    .optional()
    .isArray()
    .withMessage("Categories must be an array"),
  // Brand-specific fields
  body("brand_name")
    .optional()
    .isString()
    .isLength({ min: 2, max: 200 })
    .withMessage("Brand name must be between 2 and 200 characters"),
  body("bio")
    .optional()
    .isString()
    .isLength({ min: 0, max: 1000 })
    .withMessage("Bio must be up to 1000 characters"),
  // brand_logo is handled as file upload, no validation needed here
];

module.exports = {
  validateCompleteProfile,
};

