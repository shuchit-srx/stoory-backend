const { body } = require("express-validator");

/**
 * Subscription Validators
 * Validation rules for subscription operations
 */

const validateCreateSubscription = [
  body("plan_id")
    .notEmpty()
    .withMessage("plan_id is required")
    .isUUID()
    .withMessage("plan_id must be a valid UUID"),

  body("is_auto_renew")
    .optional()
    .isBoolean()
    .withMessage("is_auto_renew must be a boolean"),
];

module.exports = {
  validateCreateSubscription,
};

