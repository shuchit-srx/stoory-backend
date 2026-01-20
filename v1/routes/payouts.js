const express = require('express');
const router = express.Router();
const PayoutController = require('../controllers/payoutController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * Payout Routes
 * All routes require authentication
 */

// Get all pending payouts (Admin only) - Must come before /:payoutId route
router.get(
  '/pending',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('ADMIN'),
  PayoutController.getPendingPayouts
);

// Get payouts for an application - Must come before /:payoutId route
router.get(
  '/application/:applicationId',
  authMiddleware.authenticateToken,
  PayoutController.getApplicationPayouts
);

// Create payment order for payout (Admin only) - Must come before /:payoutId route
router.post(
  '/:payoutId/pay',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('ADMIN'),
  PayoutController.createPayoutPaymentOrder
);

// Verify payout payment (Admin only)
router.post(
  '/pay/verify',
  authMiddleware.authenticateToken,
  authMiddleware.requireRole('ADMIN'),
  PayoutController.verifyPayoutPayment
);

// Get payout status - Must come last as it matches any string
router.get(
  '/:payoutId',
  authMiddleware.authenticateToken,
  PayoutController.getPayoutStatus
);

module.exports = router;

