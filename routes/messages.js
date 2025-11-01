const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const {
  MessageController,
  validateSendMessage,
} = require("../controllers/messageController");

// All routes require authentication
router.use((req, res, next) => {
  next();
}, authService.authenticateToken);

// Conversation routes - Role-based filtering
router.get("/conversations", MessageController.getConversations); // Campaign/Bid conversations only
router.get("/conversations/direct", MessageController.getDirectConversations); // Direct conversations only
router.get("/conversations/bids", MessageController.getBidConversations); // Bid conversations only
router.get(
  "/conversations/campaigns",
  MessageController.getCampaignConversations
); // Campaign conversations only
router.get(
  "/conversations/:conversation_id/messages",
  MessageController.getMessages
);
router.get(
  "/conversations/:conversation_id/context",
  MessageController.getConversationContext
);

// Test endpoint for button clicks
router.post("/test-button-click", (req, res) => {
  res.json({ success: true, message: "Test button click received", data: req.body });
});

// Button and text input handling
router.post(
  "/conversations/:conversation_id/button-click",
  (req, res, next) => {
    next();
  },
  MessageController.handleButtonClick
);
router.post(
  "/conversations/:conversation_id/text-input",
  MessageController.handleTextInput
);

// Handle the specific URL pattern the frontend is using
// This allows URLs like /api/messages/sample-campaign-1-sample-influencer-1
// ⚠️ WILDCARD ROUTE MUST BE LAST (after all specific routes)
router.get("/:conversation_identifier", async (req, res) => {
  try {
    const { conversation_identifier } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.id; // Get authenticated user ID

    // Try to find conversation by the identifier WITH USER ACCESS CONTROL
    const { data: conversation, error: convError } =
      await require("../supabase/client")
        .supabaseAdmin.from("conversations")
        .select("id, brand_owner_id, influencer_id")
        .eq("id", conversation_identifier) // Use eq instead of or for exact match
        .or(`brand_owner_id.eq.${userId},influencer_id.eq.${userId}`) // SECURITY: Only conversations user has access to
        .single();

    if (convError || !conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found or access denied",
        suggestion:
          "Use /api/messages/conversations/:conversation_id/messages for valid conversation IDs",
      });
    }

    // Verify user has access to this conversation (double-check)
    if (conversation.brand_owner_id !== userId && conversation.influencer_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this conversation",
      });
    }

    // If found, redirect to the proper messages endpoint
    // Call the getMessages method directly
    req.params.conversation_id = conversation.id;
    return MessageController.getMessages(req, res);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      suggestion:
        "Use /api/messages/conversations/:conversation_id/messages for valid conversation IDs",
    });
  }
});

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

// Direct connect routes
router.post("/direct-connect", MessageController.initiateDirectConnect);
router.get("/direct-connections", MessageController.getDirectConnections);
router.post("/direct-message", MessageController.sendDirectMessage);

// Utility routes
router.get("/unread-count", MessageController.getUnreadCount);

module.exports = router;
