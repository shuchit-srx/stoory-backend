const { body } = require("express-validator");

const validateVerifyPAN = [
  body("pan")
    .optional()
    .isString()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .withMessage("PAN number must be in format: AAAAA9999A"),
  body("pan_number")
    .optional()
    .isString()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .withMessage("PAN number must be in format: AAAAA9999A"),
  body("consent_text")
    .optional()
    .isString()
    .withMessage("Consent text must be a string"),
  body("task_id")
    .optional()
    .isString()
    .isUUID()
    .withMessage("Task ID must be a valid UUID"),
  // At least one of pan or pan_number must be provided
  body("pan")
    .custom((value, { req }) => {
      if (!value && !req.body?.pan_number) {
        throw new Error("Either 'pan' or 'pan_number' is required");
      }
      return true;
    }),
];

module.exports = {
  validateVerifyPAN,
};

