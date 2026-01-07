const { body, param } = require('express-validator');

/**
 * Submission Validators
 * Validation rules for script and work submission operations
 */

const validateSubmitScript = [
  body('applicationId')
    .notEmpty()
    .withMessage('applicationId is required')
    .isUUID()
    .withMessage('applicationId must be a valid UUID'),
  body('fileUrl')
    .optional()
    .isURL()
    .withMessage('fileUrl must be a valid URL'),
];

const validateSubmitWork = [
  body('applicationId')
    .notEmpty()
    .withMessage('applicationId is required')
    .isUUID()
    .withMessage('applicationId must be a valid UUID'),
  body('fileUrl')
    .optional()
    .isURL()
    .withMessage('fileUrl must be a valid URL'),
];

const validateReviewScript = [
  param('id')
    .notEmpty()
    .withMessage('Script ID is required')
    .isUUID()
    .withMessage('Script ID must be a valid UUID'),
  body('status')
    .notEmpty()
    .withMessage('status is required')
    .isString()
    .custom((value) => {
      const normalized = String(value).toUpperCase().trim();
      const validStatuses = ['ACCEPTED', 'REVISION', 'REJECTED'];
      if (!validStatuses.includes(normalized)) {
        throw new Error('status must be ACCEPTED, REVISION, or REJECTED');
      }
      return true;
    }),
  body('rejectionReasonId')
    .optional()
    .isUUID()
    .withMessage('rejectionReasonId must be a valid UUID'),
  body('remarks')
    .optional()
    .isString()
    .isLength({ max: 5000 })
    .withMessage('remarks must be up to 5000 characters'),
];

const validateReviewWork = [
  param('id')
    .notEmpty()
    .withMessage('Work submission ID is required')
    .isUUID()
    .withMessage('Work submission ID must be a valid UUID'),
  body('status')
    .notEmpty()
    .withMessage('status is required')
    .isString()
    .custom((value) => {
      const normalized = String(value).toUpperCase().trim();
      const validStatuses = ['ACCEPTED', 'REVISION', 'REJECTED'];
      if (!validStatuses.includes(normalized)) {
        throw new Error('status must be ACCEPTED, REVISION, or REJECTED');
      }
      return true;
    }),
  body('rejectionReasonId')
    .optional()
    .isUUID()
    .withMessage('rejectionReasonId must be a valid UUID'),
  body('remarks')
    .optional()
    .isString()
    .isLength({ max: 5000 })
    .withMessage('remarks must be up to 5000 characters'),
];

const validateGetScripts = [
  param('applicationId')
    .notEmpty()
    .withMessage('applicationId is required')
    .isUUID()
    .withMessage('applicationId must be a valid UUID'),
];

const validateGetWorkSubmissions = [
  param('applicationId')
    .notEmpty()
    .withMessage('applicationId is required')
    .isUUID()
    .withMessage('applicationId must be a valid UUID'),
];

module.exports = {
  validateSubmitScript,
  validateSubmitWork,
  validateReviewScript,
  validateReviewWork,
  validateGetScripts,
  validateGetWorkSubmissions,
};

