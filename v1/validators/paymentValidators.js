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

// Validate campaignId in URL params
const validateCampaignIdParam = [
  param('campaignId')
    .notEmpty()
    .withMessage('Campaign ID is required')
    .isUUID()
    .withMessage('Campaign ID must be a valid UUID'),
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
    .optional()
    .isUUID()
    .withMessage('application_id must be a valid UUID'),
];

// Validate bulk payment request body
const validateBulkPayment = [
  body('application_ids')
    .notEmpty()
    .withMessage('application_ids is required')
    .isArray({ min: 1 })
    .withMessage('application_ids must be a non-empty array'),
  body('application_ids.*')
    .isUUID()
    .withMessage('Each application_id must be a valid UUID'),
];

module.exports = {
  validateApplicationIdParam,
  validateVerifyPayment,
  validateCampaignIdParam,
  validateBulkPayment,
};

