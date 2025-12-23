// Thin entrypoint that wires legacy (current app) and future v1 APIs

// Load legacy app/server/io (all existing routes live here)
const legacy = require("./legacy/index");
const { app, server, io } = legacy;

// Mount point for new /v1 APIs
try {
  // Expect ./v1 to export an Express Router
  const v1Router = require("./v1");
  app.use("/v1", v1Router);
} catch (err) {
  // During migration, it's fine if v1 is not ready yet
  console.warn("[v1] router not found yet, only legacy APIs are active.");
}

module.exports = { app, server, io };


