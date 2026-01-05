// Main entry point for Stoory Backend
require('dotenv').config();

// Import v1 app setup
const { app, server, io } = require("./v1/index");

// Start the server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    if (process.env.NODE_ENV === 'development') {
        console.log(`Server running on port ${PORT}`);
        console.log(`Socket.io initialized`);
        console.log(`✅ v1 API routes mounted at /api/v1`);
    }
});

// Export for potential use by other modules
module.exports = { app, server, io };

// Legacy app (commented out - can be uncommented if needed)
// const legacy = require("./legacy/index");
// const { app, server, io } = legacy;
