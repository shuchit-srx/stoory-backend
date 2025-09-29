const express = require('express');
const router = express.Router();
const directStorageController = require('../controllers/directStorageController');
const authService = require('../utils/auth');

// Upload file and send message
router.post('/conversations/:conversation_id/upload',
  authService.authenticateToken,
  directStorageController.uploadAndSendMessage
);

// Delete file
router.delete('/files/:message_id',
  authService.authenticateToken,
  directStorageController.deleteFile
);

// Get file info
router.get('/files/:message_id',
  authService.authenticateToken,
  directStorageController.getFileInfo
);

// Get supported file types
router.get('/supported-types',
  directStorageController.getSupportedTypes
);

module.exports = router;