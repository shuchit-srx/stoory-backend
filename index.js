// Thin entrypoint that wires the legacy app (which now also mounts /api/v1)
const legacy = require("./legacy/index");
const { app, server, io } = legacy;

module.exports = { app, server, io };
