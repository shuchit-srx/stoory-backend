const { body } = require("express-validator");

/**
 * OTP Authentication Validators
 */

const validateSendOTP = [
  body("phone")
    .isMobilePhone("any")
    .withMessage(
      "Please provide a valid phone number with country code (e.g., +1234567890)"
    )
    .custom((value) => {
      if (!value.startsWith("+")) {
        throw new Error(
          "Phone number must start with + and include country code"
        );
      }
      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(value)) {
        throw new Error(
          "Invalid phone number format. Use international format: +[country code][number]"
        );
      }
      return true;
    }),
];

const validateVerifyOTP = [
  body("phone")
    .isMobilePhone("any")
    .withMessage(
      "Please provide a valid phone number with country code (e.g., +1234567890)"
    )
    .custom((value) => {
      if (!value.startsWith("+")) {
        throw new Error(
          "Phone number must start with + and include country code"
        );
      }
      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(value)) {
        throw new Error(
          "Invalid phone number format. Use international format: +[country code][number]"
        );
      }
      return true;
    }),
  body("token")
    .isLength({ min: 4, max: 6 })
    .withMessage("OTP token must be 4-6 characters"),
];

module.exports = {
  validateSendOTP,
  validateVerifyOTP,
};
