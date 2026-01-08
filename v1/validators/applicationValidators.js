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