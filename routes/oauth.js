const express = require('express');
const router = express.Router();
const OAuthController = require('../controllers/oauthController');
const authService = require('../utils/auth');

// Public routes (no auth required)
// GET /api/oauth/instagram/authorize - Initiate OAuth flow
router.get('/instagram/authorize', OAuthController.authorizeInstagram);

// GET /api/oauth/instagram/callback - Handle Meta callback (public, called by Meta)
router.get('/instagram/callback', OAuthController.handleInstagramCallback);

// Protected route (requires authentication)
// POST /api/oauth/instagram/verify - Verify temporary token and save account
router.post('/instagram/verify', authService.authenticateToken, OAuthController.verifyInstagramToken);

module.exports = router;

