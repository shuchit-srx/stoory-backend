const { body } = require("express-validator");

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
  body("social_platforms.*.data_source")
    .optional()
    .isString()
    .isIn(["MANUAL", "GRAPH_API"])
    .withMessage("Data source must be MANUAL or GRAPH_API"),
  

  // Languages - array of strings
  body("languages")
    .optional()
    .isArray()
    .withMessage("Languages must be an array"),
  body("languages.*")
    .optional()
    .isString()
    .withMessage("Each language must be a string"),
  

  // Categories - array of strings
  body("categories")
    .optional()
    .isArray()
    .withMessage("Categories must be an array"),
  body("categories.*")
    .optional()
    .isString()
    .withMessage("Each category must be a string"),
  

  // Common profile fields (used by both influencer and brand)
  body("bio")
    .optional()
    .isString()
    .isLength({ min: 0, max: 5000 })
    .withMessage("Bio must be up to 5000 characters"),
  body("city")
    .optional()
    .isString()
    .isLength({ min: 0, max: 200 })
    .withMessage("City must be up to 200 characters"),
  body("country")
    .optional()
    .isString()
    .isLength({ min: 0, max: 200 })
    .withMessage("Country must be up to 200 characters"),
  body("gender")
    .optional()
    .isString()
    .isIn(["MALE", "FEMALE", "OTHER"])
    .withMessage("Gender must be MALE, FEMALE, or OTHER"),
  
  // Influencer-specific fields
  body("tier")
    .optional()
    .isString()
    .isIn(["NANO", "MICRO", "MID", "MACRO"])
    .withMessage("Tier must be NANO, MICRO, MID, or MACRO"),
  body("min_value")
    .optional()
    .isNumeric()
    .withMessage("Min value must be a number"),
  body("max_value")
    .optional()
    .isNumeric()
    .withMessage("Max value must be a number"),
  
    
  // Brand-specific fields
  body("brand_name")
    .optional()
    .isString()
    .isLength({ min: 2, max: 200 })
    .withMessage("Brand name must be between 2 and 200 characters"),
  body("brand_description")
    .optional()
    .isString()
    .isLength({ min: 0, max: 5000 })
    .withMessage("Brand description must be up to 5000 characters"),
  // brand_logo and profile_image are handled as file uploads, no URL validation needed
];

module.exports = {
  validateCompleteProfile,
};