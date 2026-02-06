const { body } = require("express-validator");

/**
 * FCM Token Validators
 * Validation rules for FCM token registration
 */

const validateRegisterToken = [
  body("token")
    .notEmpty()
    .withMessage("FCM token is required")
    .isString()
    .withMessage("FCM token must be a string")
    .trim()
    .isLength({ min: 100 })
    .withMessage("FCM token appears too short. Ensure you're sending FCM token, not APNs token. Minimum length is 100 characters.")
    .custom((value) => {
      // Basic format check
      const trimmed = value.trim();
      if (trimmed.length < 100) {
        throw new Error("FCM token is too short. Minimum length is 100 characters.");
      }
      // Check if it looks like an APNs token (64 hex chars)
      const apnsPattern = /^[0-9a-fA-F]{64}$/;
      if (apnsPattern.test(trimmed)) {
        throw new Error("This appears to be an APNs token. Please send FCM token from Firebase instead.");
      }
      // Basic pattern validation (FCM tokens contain alphanumeric, underscore, hyphen, and colon)
      const fcmPattern = /^[A-Za-z0-9_:=-]+$/;
      if (!fcmPattern.test(trimmed)) {
        throw new Error("FCM token contains invalid characters.");
      }
      return true;
    }),

  body("device_type")
    .optional()
    .isString()
    .withMessage("device_type must be a string")
    .custom((value) => {
      if (!value) return true;
      const normalized = String(value).toLowerCase().trim();
      const validValues = ["android", "ios", "web", "unknown"];
      if (!validValues.includes(normalized)) {
        throw new Error("device_type must be one of: android, ios, web, unknown");
      }
      return true;
    }),

  body("device_id")
    .optional()
    .isString()
    .withMessage("device_id must be a string")
    .trim(),
];

const validateUnregisterToken = [
  body("token")
    .notEmpty()
    .withMessage("FCM token is required")
    .isString()
    .withMessage("FCM token must be a string")
    .trim(),
];

const validateTestNotification = [
  body("title")
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage("Title must be a string with max 100 characters"),

  body("body")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("Body must be a string with max 500 characters"),

  body("data")
    .optional()
    .isObject()
    .withMessage("Data must be an object"),

  body("clickAction")
    .optional()
    .isString()
    .withMessage("clickAction must be a string"),

  body("badge")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Badge must be a non-negative integer"),
];

module.exports = {
  validateRegisterToken,
  validateUnregisterToken,
  validateTestNotification,
};

