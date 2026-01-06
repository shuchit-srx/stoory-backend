const express = require("express");
const http = require('http');
const cors = require('cors');
require('dotenv').config();

// Root router for all /api/v1 APIs
const router = express.Router();

// Mount all v1 routes
const v1Routes = require("./routes");
router.use("/", v1Routes); // → /api/v1/*

// Socket Init
const initSocket = require('./socket');

const app = express();
const server = http.createServer(app);

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

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Health check endpoint (must be before /api/v1 routes)
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Stoory Backend v1 is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    version: "1.0.0"
  });
});


// Mount the router on the app at /api/v1
app.use("/api/v1", router);

// Initialize Socket.io
const io = initSocket(server);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Server startup moved to root index.js
// const PORT = process.env.PORT || 3000;
// 
// server.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
//   console.log(`Socket.io initialized`);
//   console.log(`✅ v1 API routes mounted at /api/v1`);
// });

// Export app, server, io, and router for use by root index.js
module.exports = {
  app,
  server,
  io,
  router
};