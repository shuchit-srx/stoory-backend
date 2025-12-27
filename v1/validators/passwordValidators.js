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
];

const validateBrandLogin = [
  body("email")
    .isEmail()
    .withMessage("Valid email address required")
    .normalizeEmail(),
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
];

const validateEmailVerification = [
  body("token")
    .notEmpty()
    .withMessage("Verification token is required"),
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
  body("token")
    .notEmpty()
    .withMessage("Reset token is required"),
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
};

