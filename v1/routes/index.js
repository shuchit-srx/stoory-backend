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

// Mount v1 subscription routes
const subscriptionRoutes = require('./subscriptions');
router.use('/subscriptions', subscriptionRoutes); // → /api/v1/subscriptions/*

// Mount v1 submission routes
const submissionRoutes = require('./submissions');
router.use('/submissions', submissionRoutes); // → /api/v1/submissions/*

module.exports = router;
