const router = require('express').Router();
const submissionController = require('../controllers/submissionController');
const authMiddleware = require('../middleware/authMiddleware');
const { normalizeEnums } = require('../middleware/enumNormalizer');
const {
  validateSubmitScript,
  validateSubmitWork,
  validateReviewScript,
  validateReviewWork,
  validateGetScripts,
  validateGetWorkSubmissions,
} = require('../validators/submissionValidators');

// Influencer routes
router.post(
  '/scripts',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('INFLUENCER'),
  normalizeEnums,
  submissionController.upload,
  validateSubmitScript,
  submissionController.submitScript
);

router.post(
  '/work',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('INFLUENCER'),
  normalizeEnums,
  submissionController.upload,
  validateSubmitWork,
  submissionController.submitWork
);

router.get(
  '/applications/:applicationId/scripts',
  authMiddleware.authenticateToken,
  validateGetScripts,
  submissionController.getScripts
);

router.get(
  '/applications/:applicationId/work',
  authMiddleware.authenticateToken,
  validateGetWorkSubmissions,
  submissionController.getWorkSubmissions
);

// Brand Owner routes
router.post(
  '/scripts/:id/review',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('BRAND_OWNER'),
  normalizeEnums,
  validateReviewScript,
  submissionController.reviewScript
);

router.post(
  '/work/:id/review',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('BRAND_OWNER'),
  normalizeEnums,
  validateReviewWork,
  submissionController.reviewWork
);

module.exports = router;

