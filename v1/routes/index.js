const express = require("express");
const router = express.Router();


// Mount v1 auth routes
const authRoutes = require("./auth");
router.use("/auth", authRoutes); // → /api/v1/auth/*

// Mount v1 profile routes
const profileRoutes = require("./profile");
router.use("/profile", profileRoutes); // → /api/v1/profile/*

// Mount v1 campaign routes
const campaignRoutes = require("./campaigns");
router.use("/campaigns", campaignRoutes); // → /api/v1/campaigns/*

// Mount v1 campaign routes
const applicationRoutes = require('./applications');
router.use('/applications', applicationRoutes); // → /api/v1/applications/*

const chatRoutes = require('./chat');
router.use('/chat', chatRoutes); // → /api/v1/chat/*

// Mount v1 user routes
const userRoutes = require('./users');
router.use('/users', userRoutes); // → /api/v1/users/*

// Mount v1 plan routes
const planRoutes = require('./plans');
router.use('/plans', planRoutes); // → /api/v1/plans/*

// Mount v1 payment routes
const paymentRoutes = require('./payments');
router.use('/payments', paymentRoutes); // → /api/v1/payments/*

// Mount v1 notification routes
const notificationRoutes = require('./notifications');
router.use('/notifications', notificationRoutes); // → /api/v1/notifications/*

// Mount v1 subscription routes
const subscriptionRoutes = require('./subscriptions');
router.use('/subscriptions', subscriptionRoutes); // → /api/v1/subscriptions/*

// Mount v1 submission routes
const submissionRoutes = require('./submissions');
router.use('/submissions', submissionRoutes); // → /api/v1/submissions/*

// Mount v1 MOU routes
const mouRoutes = require('./mous');
router.use('/mous', mouRoutes); // → /api/v1/mous/*

// Mount v1 admin settings routes
const adminSettingsRoutes = require('./adminSettings');
router.use('/admin/settings', adminSettingsRoutes); // → /api/v1/admin/settings/*

// Mount v1 coupon routes
const couponRoutes = require('./coupons');
router.use('/coupons', couponRoutes); // → /api/v1/coupons/*

// Mount v1 portfolio routes
const portfolioRoutes = require('./portfolios');
router.use('/portfolios', portfolioRoutes); // → /api/v1/portfolios/*

// Mount v1 payout routes
const payoutRoutes = require('./payouts');
router.use('/payouts', payoutRoutes); // → /api/v1/payouts/*

// Mount v1 transaction routes
const transactionRoutes = require('./transactions');
router.use('/transactions', transactionRoutes); // → /api/v1/transactions/*

// Mount v1 reports routes
const reportRoutes = require('./reports');
router.use('/reports', reportRoutes); // → /api/v1/reports/*

module.exports = router;
