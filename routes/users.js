const express = require('express');
const router = express.Router();
const authService = require('../utils/auth');
const { UserController } = require('../controllers/userController');

// Protect all user routes
router.use(authService.authenticateToken);

// Brand owners and admins can list influencers
router.get('/influencers', authService.requireRole(['brand_owner', 'admin']), UserController.listInfluencers);

module.exports = router;



