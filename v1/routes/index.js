const express = require("express");
const router = express.Router();

const authRoutes = require("./auth");
router.use("/auth", authRoutes); // → /api/v1/auth/*

const profileRoutes = require("./profile");
router.use("/profile", profileRoutes); // → /api/v1/profile/*

const campaignRoutes = require("./campaigns");
router.use("/campaigns", campaignRoutes); // → /api/v1/campaigns/*

const applicationRoutes = require('./applications');
router.use('/applications', applicationRoutes); // → /api/v1/applications/*

const chatRoutes = require('./chat');
router.use('/chat', chatRoutes); // → /api/v1/chat/*

const userRoutes = require('./users');
router.use('/users', userRoutes); // → /api/v1/users/*

const planRoutes = require('./plans');
router.use('/plans', planRoutes); // → /api/v1/plans/*

const paymentRoutes = require('./payments');
router.use('/payments', paymentRoutes); // → /api/v1/payments/*

const notificationRoutes = require('./notifications');
router.use('/notifications', notificationRoutes); // → /api/v1/notifications/*

const subscriptionRoutes = require('./subscriptions');
router.use('/subscriptions', subscriptionRoutes); // → /api/v1/subscriptions/*

const submissionRoutes = require('./submissions');
router.use('/submissions', submissionRoutes); // → /api/v1/submissions/*

const mouRoutes = require('./mous');
router.use('/mous', mouRoutes); // → /api/v1/mous/*

const adminSettingsRoutes = require('./adminSettings');
router.use('/admin/settings', adminSettingsRoutes); // → /api/v1/admin/settings/*

const couponRoutes = require('./coupons');
router.use('/coupons', couponRoutes); // → /api/v1/coupons/*

const portfolioRoutes = require('./portfolios');
router.use('/portfolios', portfolioRoutes); // → /api/v1/portfolios/*

const payoutRoutes = require('./payouts');
router.use('/payouts', payoutRoutes); // → /api/v1/payouts/*

const transactionRoutes = require('./transactions');
router.use('/transactions', transactionRoutes); // → /api/v1/transactions/*

const reportRoutes = require('./reports');
router.use('/reports', reportRoutes); // → /api/v1/reports/*

module.exports = router;
