// 1st PART
// ---------------------------------------
require('dotenv').config();
const { app, server, io } = require("./v1/index");
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



// 2nd PART (Legacy app)
// ---------------------------------------
// const legacy = require("./legacy/index");
// const { app, server, io } = legacy;



// LEAVE THIS AS IT IS
// ---------------------------------------
module.exports = { app, server, io };
