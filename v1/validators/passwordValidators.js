const { body } = require("express-validator");

/**
 * Password Authentication Validators
 * For brand owner email/password authentication
 */

const validateBrandRegister = [
  body("email")
    .isEmail()
    .withMessage("Valid email address required")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  body("name")
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters")
    .trim(),
  body("fcm_token")
    .optional()
    .isString()
    .withMessage("fcm_token must be a string")
    .trim(),
  body("device_type")
    .optional()
    .isString()
    .withMessage("device_type must be a string")
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toLowerCase().trim();
      const validValues = ["android", "ios", "web", "unknown"];
      if (!validValues.includes(normalized)) {
        throw new Error(
          "device_type must be one of: android, ios, web, unknown"
        );
      }
      return true;
    }),
  body("device_id")
    .optional()
    .isString()
    .withMessage("device_id must be a string")
    .trim(),
  body("phone_number")
    .optional()
    .isString()
    .withMessage("phone_number must be a string")
    .trim(),
  body("brand_name")
    .optional()
    .isString()
    .withMessage("brand_name must be a string")
    .trim(),
  body("brand_description")
    .optional()
    .isString()
    .withMessage("brand_description must be a string")
    .trim(),
  body("dob")
    .optional()
    .isISO8601()
    .withMessage("dob must be a valid date (YYYY-MM-DD)"),
  body("gender")
    .optional()
    .isString()
    .withMessage("gender must be a string")
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toUpperCase().trim();
      const validGenders = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];
      if (!validGenders.includes(normalized)) {
        throw new Error("gender must be one of: MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY");
      }
      return true;
    }),
];

const validateBrandLogin = [
  body("email")
    .isEmail()
    .withMessage("Valid email address required")
    .normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required"),
  body("fcm_token")
    .optional()
    .isString()
    .withMessage("fcm_token must be a string")
    .trim(),
  body("device_type")
    .optional()
    .isString()
    .withMessage("device_type must be a string")
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toLowerCase().trim();
      const validValues = ["android", "ios", "web", "unknown"];
      if (!validValues.includes(normalized)) {
        throw new Error(
          "device_type must be one of: android, ios, web, unknown"
        );
      }
      return true;
    }),
  body("device_id")
    .optional()
    .isString()
    .withMessage("device_id must be a string")
    .trim(),
];

const validateEmailVerification = [
  body("token").notEmpty().withMessage("Verification token is required"),
];

const validateResendEmailVerification = [
  body("email")
    .isEmail()
    .withMessage("Valid email address required")
    .normalizeEmail(),
];

const validateForgotPassword = [
  body("email")
    .isEmail()
    .withMessage("Valid email address required")
    .normalizeEmail(),
];

const validateResetPassword = [
  body("token").notEmpty().withMessage("Reset token is required"),
  body("new_password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
];

const validateChangePassword = [
  body("current_password")
    .notEmpty()
    .withMessage("Current password is required"),
  body("new_password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
];

module.exports = {
  validateBrandRegister,
  validateBrandLogin,
  validateEmailVerification,
  validateResendEmailVerification,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
};
