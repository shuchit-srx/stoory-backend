const express = require('express');
const router = express.Router();
const authService = require('../utils/auth');
const whatsappService = require('../utils/whatsapp');
const { upload } = require('../utils/imageUpload');
const {
    AuthController,
    validateSendOTP,
    validateVerifyOTP,
    validateUpdateProfile,
    validateVerificationDocument
} = require('../controllers/authController');

const {
    SocialPlatformController,
    validateSocialPlatform,
    validateSocialPlatformUpdate
} = require('../controllers/socialPlatformController');

// Public routes
router.post('/send-otp', validateSendOTP, AuthController.sendOTP);
router.post('/send-registration-otp', validateSendOTP, AuthController.sendRegistrationOTP);
router.post('/verify-otp', validateVerifyOTP, AuthController.verifyOTP);
router.post('/refresh-token', AuthController.refreshToken);

// WhatsApp service status (for debugging)
router.get('/whatsapp-status', (req, res) => {
    const status = whatsappService.getServiceStatus();
    res.json({
        success: true,
        whatsapp: status
    });
});

// Mock login info (for testing)
router.get('/mock-login-info', AuthController.getMockLoginInfo);



// Protected routes
router.get('/profile', authService.authenticateToken, AuthController.getProfile);
router.put('/profile', authService.authenticateToken, validateUpdateProfile, AuthController.updateProfile);
router.post('/profile/image', authService.authenticateToken, upload.single('image'), AuthController.uploadProfileImage);
router.delete('/profile/image', authService.authenticateToken, AuthController.deleteProfileImage);
router.post('/profile/verification-document', authService.authenticateToken, upload.single('verification_document'), validateVerificationDocument, AuthController.uploadVerificationDocument);

// Social platform routes
router.get('/social-platforms', authService.authenticateToken, SocialPlatformController.getSocialPlatforms);
router.post('/social-platforms', authService.authenticateToken, validateSocialPlatform, SocialPlatformController.addSocialPlatform);
router.put('/social-platforms/:id', authService.authenticateToken, validateSocialPlatformUpdate, SocialPlatformController.updateSocialPlatform);
router.delete('/social-platforms/:id', authService.authenticateToken, SocialPlatformController.deleteSocialPlatform);
router.get('/social-platforms/stats', authService.authenticateToken, SocialPlatformController.getSocialPlatformStats);

router.post('/logout', authService.authenticateToken, AuthController.logout);
router.delete('/account', authService.authenticateToken, AuthController.deleteAccount);

module.exports = router; 