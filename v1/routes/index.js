const express = require("express");
const router = express.Router();


// Mount v1 auth routes
const authRoutes = require("./auth");
router.use("/auth", authRoutes); // → /api/v1/auth/*

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

module.exports = router;
