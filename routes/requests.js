const express = require('express');
const router = express.Router();
const authService = require('../utils/auth');
const {
    RequestController,
    validateCreateRequest,
    validateUpdateRequestStatus
} = require('../controllers/requestController');

// All routes require authentication
router.use(authService.authenticateToken);

// Request operations
router.post('/', authService.requireRole('influencer'), validateCreateRequest, RequestController.createRequest);
router.get('/', RequestController.getRequests);
router.get('/:id', RequestController.getRequest);
router.put('/:id/status', authService.requireRole(['brand_owner', 'admin']), validateUpdateRequestStatus, RequestController.updateRequestStatus);
router.put('/:id/agree', authService.requireRole('influencer'), RequestController.updateAgreedAmount);
router.delete('/:id', authService.requireRole('influencer'), RequestController.withdrawRequest);

// Payment routes
router.post('/approval-payment', authService.requireRole(['brand_owner', 'admin']), RequestController.processApprovalPayment);
router.post('/completion-payment', authService.requireRole(['brand_owner', 'admin']), RequestController.processCompletionPayment);

// Influencer list routes for bids and campaigns
router.get('/bid/:bid_id/influencers', RequestController.getBidInfluencers);
router.get('/campaign/:campaign_id/influencers', RequestController.getCampaignInfluencers);
router.get('/bid/:bid_id/influencer-count', RequestController.getBidInfluencerCount);
router.get('/campaign/:campaign_id/influencer-count', RequestController.getCampaignInfluencerCount);

module.exports = router; 