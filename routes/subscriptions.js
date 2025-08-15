const express = require('express');
const router = express.Router();
const authService = require('../utils/auth');
const { SubscriptionController } = require('../controllers/subscriptionController');

// Public routes (no authentication required)
router.get('/plans', SubscriptionController.getPlans);
router.get('/payment-config', SubscriptionController.getPaymentConfig);
router.post('/webhook', SubscriptionController.handleWebhook);

// Protected routes (require authentication)
router.get('/status', authService.authenticateToken, SubscriptionController.getSubscriptionStatus);
router.post('/create-order', authService.authenticateToken, SubscriptionController.createSubscriptionOrder);
router.post('/process-payment', authService.authenticateToken, SubscriptionController.processSubscriptionPayment);
router.get('/payment-status/:payment_id', authService.authenticateToken, SubscriptionController.getPaymentStatus);
router.post('/update-payment-status', authService.authenticateToken, SubscriptionController.updatePaymentStatus);
router.post('/cancel', authService.authenticateToken, SubscriptionController.cancelSubscription);
router.get('/history', authService.authenticateToken, SubscriptionController.getSubscriptionHistory);

// Test endpoints (for testing only)
router.post('/test-create', authService.authenticateToken, SubscriptionController.createTestSubscription);
router.post('/test-payment', authService.authenticateToken, SubscriptionController.processTestPayment);

module.exports = router;
