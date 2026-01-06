const { body, param } = require('express-validator');

/**
 * Application Validators
 * Validation rules for application operations
 */

const validateApply = [
  body('campaignId')
    .notEmpty()
    .withMessage('campaignId is required')
    .isUUID()
    .withMessage('campaignId must be a valid UUID'),
];

const validateAccept = [
  param('id')
    .notEmpty()
    .withMessage('Application ID is required')
    .isUUID()
    .withMessage('Application ID must be a valid UUID'),
  body('agreedAmount')
    .notEmpty()
    .withMessage('agreedAmount is required')
    .isFloat({ min: 0 })
    .withMessage('agreedAmount must be a non-negative number'),
  body('platformFeePercent')
    .notEmpty()
    .withMessage('platformFeePercent is required')
    .isFloat({ min: 0, max: 100 })
    .withMessage('platformFeePercent must be between 0 and 100'),
  body('requiresScript')
    .optional()
    .isBoolean()
    .withMessage('requiresScript must be a boolean'),
];

const validateBulkAccept = [
  body('campaignId')
    .notEmpty()
    .withMessage('campaignId is required')
    .isUUID()
    .withMessage('campaignId must be a valid UUID'),
  body('applications')
    .isArray({ min: 1 })
    .withMessage('applications must be a non-empty array'),
  body('applications.*.applicationId')
    .notEmpty()
    .withMessage('applicationId is required for each application')
    .isUUID()
    .withMessage('applicationId must be a valid UUID for each application'),
  body('applications.*.agreedAmount')
    .notEmpty()
    .withMessage('agreedAmount is required for each application')
    .isFloat({ min: 0 })
    .withMessage('agreedAmount must be a non-negative number for each application'),
  body('applications.*.platformFeePercent')
    .notEmpty()
    .withMessage('platformFeePercent is required for each application')
    .isFloat({ min: 0, max: 100 })
    .withMessage('platformFeePercent must be between 0 and 100 for each application'),
  body('applications.*.requiresScript')
    .optional()
    .isBoolean()
    .withMessage('requiresScript must be a boolean for each application'),
];

const validateCancel = [
  param('id')
    .notEmpty()
    .withMessage('Application ID is required')
    .isUUID()
    .withMessage('Application ID must be a valid UUID'),
];

const validateComplete = [
  param('id')
    .notEmpty()
    .withMessage('Application ID is required')
    .isUUID()
    .withMessage('Application ID must be a valid UUID'),
];

module.exports = {
  validateApply,
  validateAccept,
  validateBulkAccept,
  validateCancel,
  validateComplete,
};