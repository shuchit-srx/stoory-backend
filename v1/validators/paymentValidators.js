const { body, param } = require('express-validator');

/**
 * Payment Validators
 * Validation rules for payment operations
 */

// Validate applicationId in URL params
const validateApplicationIdParam = [
  param('applicationId')
    .notEmpty()
    .withMessage('Application ID is required')
    .isUUID()
    .withMessage('Application ID must be a valid UUID'),
];

// Validate verify payment request body
const validateVerifyPayment = [
  body('razorpay_order_id')
    .notEmpty()
    .withMessage('razorpay_order_id is required')
    .isString()
    .withMessage('razorpay_order_id must be a string')
    .trim(),
  body('razorpay_payment_id')
    .notEmpty()
    .withMessage('razorpay_payment_id is required')
    .isString()
    .withMessage('razorpay_payment_id must be a string')
    .trim(),
  body('razorpay_signature')
    .notEmpty()
    .withMessage('razorpay_signature is required')
    .isString()
    .withMessage('razorpay_signature must be a string')
    .trim(),
  body('application_id')
    .notEmpty()
    .withMessage('application_id is required')
    .isUUID()
    .withMessage('application_id must be a valid UUID'),
];

module.exports = {
  validateApplicationIdParam,
  validateVerifyPayment,
};

