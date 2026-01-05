// Main entry point for Stoory Backend
require('dotenv').config();

// Import v1 app setup
const { app, server, io } = require("./v1/index");

// Start the server
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    if (process.env.NODE_ENV === 'development') {
        console.log(`Server running on port ${PORT}`);
        console.log(`Socket.io initialized`);
        console.log(`✅ v1 API routes mounted at /api/v1`);
    } else {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🔗 Health check: http://0.0.0.0:${PORT}/health`);
    }
}).on('error', (err) => {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
});

// Export for potential use by other modules
module.exports = { app, server, io };

// Legacy app (commented out - can be uncommented if needed)
// const legacy = require("./legacy/index");
// const { app, server, io } = legacy;
