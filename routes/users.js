const express = require('express');
const router = express.Router();
const authService = require('../utils/auth');
const { UserController } = require('../controllers/userController');
const { validateVerificationDetails, validateVerificationDocument } = require('../controllers/authController');
const { upload } = require('../utils/imageUpload');

// Protect all user routes
router.use(authService.authenticateToken);

// Brand owners and admins can list influencers
router.get('/influencers', authService.requireRole(['brand_owner', 'admin']), UserController.listInfluencers);

// Admin can list brand owners
router.get('/brand-owners', authService.requireRole(['admin']), UserController.listBrandOwners);

// Admin user stats
router.get('/stats', authService.requireRole(['admin']), UserController.getUserStats);

// User profile and verification routes
router.get('/profile', UserController.getUserProfile);
router.get('/verification-status', UserController.getVerificationStatus);
router.put('/verification-details', validateVerificationDetails, UserController.updateVerificationDetails);
router.post('/verification-document', upload.single('verification_document'), validateVerificationDocument, UserController.uploadVerificationDocument);

// Public profile lookups with role-based visibility
router.get('/influencers/:id', UserController.getInfluencerById);
router.get('/brand-owners/:id', UserController.getBrandOwnerById);

module.exports = router;



