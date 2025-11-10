const express = require('express');
const router = express.Router();
const adminSettingsController = require('../controllers/adminSettingsController');
const authService = require('../utils/auth');

// Auth
router.use(authService.authenticateToken);

// Admin role check
router.use((req, res, next) => {
	if (req.user.role !== 'admin') {
		return res.status(403).json({ success: false, message: 'Admin access required' });
	}
	next();
});

// GET /api/admin/settings/system
router.get('/system', adminSettingsController.getSystemSettings);

// PUT /api/admin/settings/system
router.put('/system', adminSettingsController.updateSystemSettings);

// Optional: audit trail
router.get('/system/audit', adminSettingsController.getAudit);

// Optional: simulate maintenance in non-prod
router.post('/system/test-maintenance', adminSettingsController.testMaintenance);

module.exports = router;
