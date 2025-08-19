const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const {
  MessageController,
  validateSendMessage,
} = require("../controllers/messageController");
const { body } = require("express-validator");

// All routes require authentication
router.use(authService.authenticateToken);

// Conversation routes
router.post("/conversations", MessageController.createConversation);
router.get("/conversations", MessageController.getConversations);
router.get(
  "/conversations/:conversation_id/messages",
  MessageController.getMessages
);
// Allow POST to base path with conversation_id in body for compatibility
router.post("/", validateSendMessage, MessageController.sendMessage);
router.post(
  "/conversations/:conversation_id/messages",
  validateSendMessage,
  MessageController.sendMessage
);
router.put(
  "/conversations/:conversation_id/seen",
  MessageController.markMessagesAsSeen
);
router.delete("/messages/:message_id", MessageController.deleteMessage);

// New automated chat and work management routes
router.post(
  "/send-automated",
  [
    body("conversation_id")
      .isUUID()
      .withMessage("Conversation ID must be a valid UUID"),
    body("message_type").isString().withMessage("Message type is required"),
    body("action_data")
      .optional()
      .isObject()
      .withMessage("Action data must be an object"),
  ],
  MessageController.sendAutomatedMessage
);

router.post(
  "/conversations/:conversation_id/enable-realtime",
  MessageController.enableRealtimeChat
);

router.post(
  "/conversations/:conversation_id/submit-work",
  [
    body("work_submission_link")
      .optional()
      .isURL()
      .withMessage("Work submission link must be a valid URL"),
    body("work_description")
      .optional()
      .isString()
      .withMessage("Work description must be a string"),
    body("work_files")
      .optional()
      .isArray()
      .withMessage("Work files must be an array"),
  ],
  MessageController.submitWorkInChat
);

router.post(
  "/conversations/:conversation_id/approve-work",
  MessageController.approveWorkInChat
);

router.post(
  "/conversations/:conversation_id/request-revision",
  [
    body("revision_reason")
      .optional()
      .isString()
      .withMessage("Revision reason must be a string"),
  ],
  MessageController.requestRevisionInChat
);

// Direct connect routes
router.post("/direct-connect", MessageController.initiateDirectConnect);
router.get("/direct-connections", MessageController.getDirectConnections);
router.post("/direct-message", MessageController.sendDirectMessage);

// Debug routes
router.get("/debug/:conversation_id", MessageController.debugConversation);

// Automated conversation routes
router.post(
  "/conversations/:conversation_id/button-click",
  MessageController.handleButtonClick
);
router.post(
  "/conversations/:conversation_id/text-input",
  MessageController.handleTextInput
);

// Utility routes
router.get("/unread-count", MessageController.getUnreadCount);

module.exports = router;
