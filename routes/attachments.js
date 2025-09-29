const express = require('express');
const router = express.Router();
const attachmentController = require('../controllers/attachmentController');
const attachmentService = require('../utils/attachmentService');
const authService = require('../utils/auth');

// Upload attachment for a conversation
router.post('/conversations/:conversation_id/upload', 
  authService.authenticateToken, 
  attachmentController.uploadAttachment
);

// Send message with attachment
router.post('/conversations/:conversation_id/send-with-attachment',
  authService.authenticateToken,
  attachmentController.sendMessageWithAttachment
);

// Upload with FormData (for Android content URIs)
router.post('/conversations/:conversation_id/upload-formdata',
  authService.authenticateToken,
  attachmentController.uploadWithFormData
);

// Delete attachment
router.delete('/attachments/:attachment_id',
  authService.authenticateToken,
  attachmentController.deleteAttachment
);

// Get attachment info
router.get('/attachments/:attachment_id',
  authService.authenticateToken,
  attachmentController.getAttachmentInfo
);

// Get supported file types
router.get('/supported-types', (req, res) => {
  res.json({
    success: true,
    fileTypes: attachmentService.FILE_TYPES
  });
});

module.exports = router;
