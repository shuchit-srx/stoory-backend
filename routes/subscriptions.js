const express = require('express');
const router = express.Router();
const authService = require('../utils/auth');
const { SubscriptionController } = require('../controllers/subscriptionController');

// Public routes (no authentication required)
router.get('/plans', SubscriptionController.getPlans);
router.get('/payment-config', SubscriptionController.getPaymentConfig);
router.post('/webhook', SubscriptionController.handleWebhook);
router.post('/check-unprocessed-payments', SubscriptionController.checkUnprocessedPayments);

// Protected routes (require authentication)
router.get('/status', authService.authenticateToken, SubscriptionController.getSubscriptionStatus);
router.post('/create-order', authService.authenticateToken, SubscriptionController.createSubscriptionOrder);
router.post('/process-payment', authService.authenticateToken, SubscriptionController.processSubscriptionPayment);
router.post('/create-free', authService.authenticateToken, SubscriptionController.createFreeSubscription);
router.get('/payment-status/:payment_id', authService.authenticateToken, SubscriptionController.getPaymentStatus);
router.post('/update-payment-status', authService.authenticateToken, SubscriptionController.updatePaymentStatus);
router.post('/cancel', authService.authenticateToken, SubscriptionController.cancelSubscription);
router.get('/history', authService.authenticateToken, SubscriptionController.getSubscriptionHistory);

// Admin plan management routes
router.get('/admin/plans', authService.authenticateToken, authService.requireRole('admin'), SubscriptionController.adminListPlans);
router.post('/admin/plans', authService.authenticateToken, authService.requireRole('admin'), SubscriptionController.adminCreatePlan);
router.put('/admin/plans/:id', authService.authenticateToken, authService.requireRole('admin'), SubscriptionController.adminUpdatePlan);
router.delete('/admin/plans/:id', authService.authenticateToken, authService.requireRole('admin'), SubscriptionController.adminDeletePlan);

// Test endpoints (for testing only)
router.post('/test-create', authService.authenticateToken, SubscriptionController.createTestSubscription);
router.post('/test-payment', authService.authenticateToken, SubscriptionController.processTestPayment);

module.exports = router;
