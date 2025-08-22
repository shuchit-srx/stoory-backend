const express = require("express");
const router = express.Router();
const authService = require("../utils/auth");
const {
  MessageController,
  validateSendMessage,
} = require("../controllers/messageController");

// All routes require authentication
router.use(authService.authenticateToken);

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

// Button and text input handling
router.post(
  "/conversations/:conversation_id/button-click",
  MessageController.handleButtonClick
);
router.post(
  "/conversations/:conversation_id/text-input",
  MessageController.handleTextInput
);

// Handle the specific URL pattern the frontend is using
// This allows URLs like /api/messages/sample-campaign-1-sample-influencer-1
router.get("/:conversation_identifier", async (req, res) => {
  try {
    const { conversation_identifier } = req.params;
    const { page = 1, limit = 50 } = req.query;

    console.log(
      `🔍 Frontend requested conversation with identifier: ${conversation_identifier}`
    );

    // Try to find conversation by the identifier
    // This could be a slug, name, or other identifier
    const { data: conversation, error: convError } =
      await require("../supabase/client")
        .supabaseAdmin.from("conversations")
        .select("id, brand_owner_id, influencer_id")
        .or(`id.eq.${conversation_identifier}`)
        .single();

    if (convError || !conversation) {
      console.log(
        `❌ Conversation not found for identifier: ${conversation_identifier}`
      );
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
        suggestion:
          "Use /api/messages/conversations/:conversation_id/messages for valid conversation IDs",
      });
    }

    // If found, redirect to the proper messages endpoint
    console.log(
      `✅ Found conversation ${conversation.id}, redirecting to messages endpoint`
    );

    // Call the getMessages method directly
    req.params.conversation_id = conversation.id;
    return MessageController.getMessages(req, res);
  } catch (error) {
    console.error("❌ Error handling conversation identifier:", error);
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
