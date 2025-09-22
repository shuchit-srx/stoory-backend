const express = require('express');
const router = express.Router();
const authService = require('../utils/auth');
const whatsappService = require('../utils/whatsapp');
const { upload } = require('../utils/imageUpload');
const {
    AuthController,
    validateSendOTP,
    validateVerifyOTP,
    validateUpdateProfile
} = require('../controllers/authController');

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
router.post('/logout', authService.authenticateToken, AuthController.logout);
router.delete('/account', authService.authenticateToken, AuthController.deleteAccount);

module.exports = router; 