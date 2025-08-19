const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const {
  MessageController,
  validateSendMessage,
} = require("../controllers/messageController");

// All routes require authentication
router.use(authService.authenticateToken);

// Alias routes to support /api/conversations/... paths
router.get("/:conversation_id/messages", MessageController.getMessages);

router.post(
  "/:conversation_id/messages",
  validateSendMessage,
  MessageController.sendMessage
);

router.put("/:conversation_id/seen", MessageController.markMessagesAsSeen);

module.exports = router;
