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

// Middleware
app.use(cors());
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