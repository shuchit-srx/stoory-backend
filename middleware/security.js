const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const express = require('express');

// Rate limiting configuration
const createRateLimiter = (windowMs, max, message = 'Too many requests') => {
    return rateLimit({
        windowMs: windowMs,
        max: max,
        message: {
            success: false,
            message: message
        },
        standardHeaders: true,
        legacyHeaders: false,
        // Fix for Railway proxy issue
        skip: (req) => {
            // Skip rate limiting for health checks
            return req.path === '/health';
        },
        // Use X-Forwarded-For header for Railway
        keyGenerator: (req) => {
            return req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
        }
    });
};

// General rate limiter
const generalLimiter = createRateLimiter(
    parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    'Too many requests from this IP'
);

// Auth rate limiter (more strict)
const authLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    5, // 5 attempts
    'Too many authentication attempts'
);

// Payment rate limiter
const paymentLimiter = createRateLimiter(
    60 * 1000, // 1 minute
    10, // 10 attempts
    'Too many payment attempts'
);

// CORS configuration
const corsOptions = {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://localhost:8080',
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/,  // Allow local network IPs
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,   // Allow local network IPs
        /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/  // Allow local network IPs
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

// Security middleware setup
const setupSecurityMiddleware = (app) => {
    // Trust proxy for Railway deployment
    app.set('trust proxy', 1);
    
    // Basic security headers
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "wss:", "ws:"]
            }
        }
    }));

    // CORS
    app.use(cors(corsOptions));

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // General rate limiting
    app.use(generalLimiter);

    // Specific rate limiting for auth routes
    app.use('/api/auth', authLimiter);

    // Specific rate limiting for payment routes
    app.use('/api/payments', paymentLimiter);

    // Request logging
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
        console.error('Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    });
};

module.exports = {
    setupSecurityMiddleware,
    generalLimiter,
    authLimiter,
    paymentLimiter
}; 