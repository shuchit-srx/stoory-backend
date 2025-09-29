const helmet = require('helmet');
const cors = require('cors');
const express = require('express');

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = process.env.CORS_ORIGIN 
            ? process.env.CORS_ORIGIN.split(',')
            : [
                'http://localhost:3000',
                'http://localhost:3001',
                'http://localhost:5173',
                'http://localhost:8080',
                'http://localhost:8081'
            ];
        
        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        
        // Check regex patterns for local network IPs
        const localNetworkPatterns = [
            /^http:\/\/192\.168\.\d+\.\d+:\d+$/,  // 192.168.x.x
            /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,   // 10.x.x.x
            /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/  // 172.16-31.x.x
        ];
        
        for (const pattern of localNetworkPatterns) {
            if (pattern.test(origin)) {
                return callback(null, true);
            }
        }
        
        // Log the blocked origin for debugging
        console.log('CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
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
    setupSecurityMiddleware
}; 