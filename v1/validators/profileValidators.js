const { body } = require("express-validator");

const validateCompleteProfile = [
  // Common fields - v1_users table
  body("name")
    .optional()
    .isString()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("email")
    .optional()
    .isEmail()
    .withMessage("Please provide a valid email address"),
  body("phone_number")
    .optional()
    .isString()
    .withMessage("Phone number must be a string"),
  
  // Common fields - profile tables
  body("pan_number")
    .optional()
    .isString()
    .isLength({ min: 10, max: 10 })
    .withMessage("PAN number must be 10 characters"),
  

  // Influencer-specific fields - Social Platforms
  body("social_platforms")
    .optional()
    .isArray()
    .withMessage("Social platforms must be an array"),
  // Accept multiple field name variations for platform
  body("social_platforms.*.platform_name")
    .optional()
    .isString()
    .withMessage("Platform name must be a string"),
  body("social_platforms.*.platform")
    .optional()
    .isString()
    .withMessage("Platform must be a string"),
  body("social_platforms.*.platformName")
    .optional()
    .isString()
    .withMessage("Platform name must be a string"),
  body("social_platforms.*.username")
    .optional()
    .isString()
    .withMessage("Username must be a string"),
  // Accept multiple field name variations for profile URL
  body("social_platforms.*.profile_url")
    .optional()
    .isURL()
    .withMessage("Profile URL must be a valid URL"),
  body("social_platforms.*.profile_link")
    .optional()
    .isURL()
    .withMessage("Profile link must be a valid URL"),
  body("social_platforms.*.profileUrl")
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
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["MANUAL", "GRAPH_API"];
      if (!validValues.includes(normalized)) {
        throw new Error("Data source must be MANUAL or GRAPH_API");
      }
      return true;
    }),
  

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
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["MALE", "FEMALE", "OTHER"];
      if (!validValues.includes(normalized)) {
        throw new Error("Gender must be MALE, FEMALE, or OTHER");
      }
      return true;
    }),
  
  // Influencer-specific fields
  body("tier")
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validValues = ["NANO", "MICRO", "MID", "MACRO"];
      if (!validValues.includes(normalized)) {
        throw new Error("Tier must be NANO, MICRO, MID, or MACRO");
      }
      return true;
    }),
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