const router = require('express').Router();
const { applicationController } = require('../controllers');
const authMiddleware = require('../middleware/authMiddleware');
const {
  validateApply,
  validateAccept,
  validateBulkAccept,
  validateCancel,
  validateComplete,
} = require('../validators/applicationValidators');

// GET all applications for the authenticated influencer
router.get(
  '/get-my-applications',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('INFLUENCER'),
  applicationController.getApplications
);

router.post(
  '/',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('INFLUENCER'),
  validateApply,
  applicationController.apply
);

router.post(
  '/:id/accept',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('BRAND_OWNER'),
  validateAccept,
  applicationController.accept
);

router.post(
  '/bulk-accept',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('BRAND_OWNER'),
  validateBulkAccept,
  applicationController.bulkAccept
);

router.post(
  '/:id/cancel',
  authMiddleware.authenticateToken,
  validateCancel,
  applicationController.cancel
);

router.post(
  '/:id/complete',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('ADMIN'),
  validateComplete,
  applicationController.complete
);

module.exports = router;