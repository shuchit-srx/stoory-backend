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

const validateSubscriptionPaymentOrder = [
  body("plan_id")
    .notEmpty()
    .withMessage("plan_id is required")
    .isUUID()
    .withMessage("plan_id must be a valid UUID"),
];

const validateVerifySubscriptionPayment = [
  body("razorpay_order_id")
    .notEmpty()
    .withMessage("razorpay_order_id is required")
    .isString()
    .withMessage("razorpay_order_id must be a string")
    .trim(),
  body("razorpay_payment_id")
    .notEmpty()
    .withMessage("razorpay_payment_id is required")
    .isString()
    .withMessage("razorpay_payment_id must be a string")
    .trim(),
  body("razorpay_signature")
    .notEmpty()
    .withMessage("razorpay_signature is required")
    .isString()
    .withMessage("razorpay_signature must be a string")
    .trim(),
  body("plan_id")
    .optional()
    .isUUID()
    .withMessage("plan_id must be a valid UUID"),
];

module.exports = {
  validateCreateSubscription,
  validateSubscriptionPaymentOrder,
  validateVerifySubscriptionPayment,
};

