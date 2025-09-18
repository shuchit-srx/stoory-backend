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

// Simple endpoint to update conversation state (no complex processing)
router.patch("/:conversation_id/state", async (req, res) => {
  try {
    const { conversation_id } = req.params;
    const { flow_state, awaiting_role } = req.body;

    // Simple database update - no complex flow logic
    const { data, error } = await req.supabase
      .from("conversations")
      .update({
        flow_state,
        awaiting_role,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation_id)
      .select();

    if (error) {
      console.error("❌ Failed to update conversation state:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to update conversation state",
      });
    }

    console.log("✅ Conversation state updated:", {
      conversation_id,
      flow_state,
      awaiting_role,
    });

    // Send FCM notification for flow state change
    const fcmService = require('../services/fcmService');
    const conversation = data[0];
    
    // Determine which user should receive the notification
    let targetUserId = null;
    if (awaiting_role === 'influencer' && conversation.influencer_id) {
      targetUserId = conversation.influencer_id;
    } else if (awaiting_role === 'brand_owner' && conversation.brand_owner_id) {
      targetUserId = conversation.brand_owner_id;
    }

    if (targetUserId) {
      fcmService.sendFlowStateNotification(conversation_id, targetUserId, flow_state).then(result => {
        if (result.success) {
          console.log(`✅ FCM flow state notification sent: ${result.sent} successful, ${result.failed} failed`);
        } else {
          console.error(`❌ FCM flow state notification failed:`, result.error);
        }
      }).catch(error => {
        console.error(`❌ FCM flow state notification error:`, error);
      });
    }

    return res.json({
      success: true,
      conversation: data[0],
    });
  } catch (error) {
    console.error("❌ Conversation state update error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

module.exports = router;
