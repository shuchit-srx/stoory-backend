const express = require('express');
const router = express.Router();
const adminWalletController = require('../controllers/adminWalletController');
const authService = require('../utils/auth');

// Apply authentication to all routes
router.use(authService.authenticateToken);

// Admin role verification middleware
router.use((req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
});

/**
 * @route GET /api/admin/wallet/transactions
 * @desc Get all transactions (with filters)
 * @access Admin only
 * @query page, limit, type, direction, status, user_id, date_from, date_to, search
 */
router.get('/transactions', adminWalletController.getAllTransactions);

/**
 * @route GET /api/admin/wallet/transactions/:id
 * @desc Get single transaction details
 * @access Admin only
 */
router.get('/transactions/:id', adminWalletController.getTransactionDetails);

/**
 * @route GET /api/admin/wallet/users
 * @desc Get all users with wallet balances
 * @access Admin only
 * @query page, limit, role, search
 */
router.get('/users', adminWalletController.getAllUsersWithWallets);

/**
 * @route GET /api/admin/wallet/users/:userId
 * @desc Get specific user's wallet details
 * @access Admin only
 */
router.get('/users/:userId', adminWalletController.getUserWalletDetails);

/**
 * @route GET /api/admin/wallet/revenue-breakdown
 * @desc Get revenue breakdown by type
 * @access Admin only
 * @query date_from, date_to, days (default: 30)
 */
router.get('/revenue-breakdown', adminWalletController.getRevenueBreakdown);

/**
 * @route GET /api/admin/wallet/statistics
 * @desc Get platform-wide statistics
 * @access Admin only
 * @query date_from, date_to, days (default: 30)
 */
router.get('/statistics', adminWalletController.getPlatformStatistics);

/**
 * @route GET /api/admin/wallet/platform-balance
 * @desc Get platform balance summary
 * @access Admin only
 */
router.get('/platform-balance', adminWalletController.getPlatformBalance);

/**
 * @route GET /api/admin/wallet/analytics
 * @desc Get transaction analytics
 * @access Admin only
 * @query period (daily/weekly/monthly), date_from, date_to
 */
router.get('/analytics', adminWalletController.getTransactionAnalytics);

module.exports = router;

