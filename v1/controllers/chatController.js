const { ChatService } = require('../services');
const { supabaseAdmin } = require('../db/config');
const attachmentService = require('../../utils/attachmentService');
const multiparty = require('multiparty');

/**
 * Get chat history for an application
 * GET /api/v1/chat/:applicationId/history
 */
const getHistory = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const userId = req.user.id;
    
    // Input validation
    if (!applicationId) {
      return res.status(400).json({ 
        success: false, 
        message: 'applicationId is required' 
      });
    }

    // Validate user access
    const hasAccess = await ChatService.validateUserAccess(userId, applicationId);
    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this application' 
      });
    }

    // Get pagination params - Standardized pagination
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Default 20, max 100
    const offset = parseInt(req.query.offset) || 0;

    // Validate pagination
    if (isNaN(limit) || limit < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid limit. Must be >= 1",
      });
    }

    if (isNaN(offset) || offset < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offset. Must be >= 0",
      });
    }

    // Get chat history
    const result = await ChatService.getChatHistory(applicationId, limit, offset);

    res.json({ 
      success: true, 
      data: result.messages || [],
      pagination: result.pagination || {
        limit,
        offset,
        count: (result.messages || []).length,
        total: result.total || 0,
        hasMore: result.hasMore || false,
      }
    });
  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get chat history' 
    });
  }
};

/**
 * Create a chat for an application
 * POST /api/v1/chat/:applicationId
 */
const createChat = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const userId = req.user.id;

    if (!applicationId) {
      return res.status(400).json({ 
        success: false, 
        message: 'applicationId is required' 
      });
    }

    // Validate user access
    const hasAccess = await ChatService.validateUserAccess(userId, applicationId);
    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this application. Invalid user access' 
      });
    }

    // Create chat
    const chat = await ChatService.createChat(applicationId);

    res.status(201).json({ 
      success: true, 
      data: chat,
      message: 'Chat created successfully'
    });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create chat' 
    });
  }
};

/**
 * Get chat details by chat ID
 * GET /api/v1/chat/:chatId
 */
const getChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    if (!chatId) {
      return res.status(400).json({ 
        success: false, 
        message: 'chatId is required' 
      });
    }

    // Get chat (access validation is done inside getChatById)
    const chat = await ChatService.getChatById(chatId, userId);

    if (!chat) {
      return res.status(404).json({ 
        success: false, 
        message: 'Chat not found' 
      });
    }

    res.json({ 
      success: true, 
      data: chat
    });
  } catch (error) {
    console.error('Get chat error:', error);
    if (error.message === 'Access denied to this chat') {
      return res.status(403).json({ 
        success: false, 
        message: error.message 
      });
    }
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get chat' 
    });
  }
};

/**
 * Get all chat IDs for the authenticated user
 * GET /api/v1/chat/user/chats
 */
const getUserChats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all chats for this user
    const chats = await ChatService.getUserChats(userId);

    res.json({
      success: true,
      data: chats,
      count: chats.length
    });
  } catch (error) {
    console.error('Get user chats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get user chats'
    });
  }
};

/**
 * Upload attachment for a chat
 * POST /api/v1/chat/:chatId/upload
 * Request Body: { fileName, mimeType, fileData (base64) }
 */
const uploadAttachment = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { fileName, mimeType, fileData } = req.body;
    const userId = req.user.id;

    if (!fileName || !mimeType || !fileData) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: fileName, mimeType, fileData'
      });
    }

    // Convert base64 file data to buffer
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(fileData, 'base64');
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file data format. Expected base64 encoded data.'
      });
    }

    // Verify chat exists and user has access
    const chat = await ChatService.getChatById(chatId, userId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Validate file
    const validation = attachmentService.validateFile(fileBuffer, fileName, mimeType);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }

    // Upload attachment (using chatId instead of conversationId)
    const result = await attachmentService.uploadAttachment(
      fileBuffer,
      fileName,
      validation.fileType,
      chatId, // Using chatId instead of conversationId
      userId
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }

    // Get attachment preview
    const preview = attachmentService.getAttachmentPreview(result.attachment);

    res.json({
      success: true,
      attachment: result.attachment,
      preview: preview,
      message: 'Attachment uploaded successfully'
    });

  } catch (error) {
    console.error('Attachment upload error:', error);
    if (error.message === 'Access denied to this chat') {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Send message with attachment
 * POST /api/v1/chat/:chatId/send-with-attachment
 * Request Body: { message (optional), fileName, mimeType, fileData (base64) }
 */
const sendMessageWithAttachment = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { message, fileName, mimeType, fileData } = req.body;
    const userId = req.user.id;

    if (!fileName || !mimeType || !fileData) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: fileName, mimeType, fileData'
      });
    }

    // Convert base64 file data to buffer
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(fileData, 'base64');
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file data format. Expected base64 encoded data.'
      });
    }

    // Verify chat exists and user has access
    const chat = await ChatService.getChatById(chatId, userId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Get application to determine receiver
    const { data: application, error: appError } = await supabaseAdmin
      .from('v1_applications')
      .select('id, influencer_id, v1_campaigns!inner(brand_id)')
      .eq('id', chat.application_id)
      .single();

    if (appError || !application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Determine receiver ID
    const receiverId = userId === application.influencer_id
      ? application.v1_campaigns?.brand_id
      : application.influencer_id;

    // Validate file
    const validation = attachmentService.validateFile(fileBuffer, fileName, mimeType);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }

    // Upload attachment
    const uploadResult = await attachmentService.uploadAttachment(
      fileBuffer,
      fileName,
      validation.fileType,
      chatId, // Using chatId instead of conversationId
      userId
    );

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: uploadResult.error
      });
    }

    // Create message with attachment using ChatService
    const savedMessage = await ChatService.saveMessage(
      userId,
      chat.application_id,
      message || `📎 Sent ${fileName}`,
      uploadResult.attachment.url
    );

    // Update message with attachment metadata
    const { error: updateError } = await supabaseAdmin
      .from('v1_chat_messages')
      .update({
        attachment_metadata: {
          fileName: uploadResult.attachment.fileName,
          fileType: uploadResult.attachment.fileType,
          mimeType: uploadResult.attachment.mimeType,
          size: uploadResult.attachment.size,
          preview: attachmentService.getAttachmentPreview(uploadResult.attachment)
        }
      })
      .eq('id', savedMessage.id);

    if (updateError) {
      console.error('Error updating attachment metadata:', updateError);
      // Don't fail the request, but log the error
    }

    // Get updated message with metadata
    const { data: updatedMessage } = await supabaseAdmin
      .from('v1_chat_messages')
      .select('*')
      .eq('id', savedMessage.id)
      .single();

    res.json({
      success: true,
      message: updatedMessage || savedMessage,
      attachment: uploadResult.attachment,
      preview: attachmentService.getAttachmentPreview(uploadResult.attachment)
    });

  } catch (error) {
    console.error('Send message with attachment error:', error);
    if (error.message === 'Access denied to this chat') {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

/**
 * Upload with FormData (for Android content URIs)
 * POST /api/v1/chat/:chatId/upload-formdata
 * Request: multipart/form-data with 'file' field and optional 'message' field
 */
const uploadWithFormData = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    // Verify chat exists and user has access
    const chat = await ChatService.getChatById(chatId, userId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Parse FormData using multiparty
    const form = new multiparty.Form();

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('FormData parsing error:', err);
        return res.status(400).json({
          success: false,
          message: 'Failed to parse FormData'
        });
      }

      const message = fields.message ? fields.message[0] : '';

      if (!files.file || !files.file[0]) {
        return res.status(400).json({
          success: false,
          message: 'No file provided in FormData'
        });
      }

      const file = files.file[0];
      const fileName = file.originalFilename || 'unknown_file';
      const mimeType = file.headers['content-type'] || 'application/octet-stream';

      // Read file from temporary path
      const fs = require('fs');
      const fileBuffer = fs.readFileSync(file.path);

      // Clean up temporary file
      try {
        fs.unlinkSync(file.path);
      } catch (cleanupError) {
        console.warn('Failed to clean up temporary file:', cleanupError.message);
      }

      try {
        // Get application to determine receiver
        const { data: application, error: appError } = await supabaseAdmin
          .from('v1_applications')
          .select('id, influencer_id, v1_campaigns!inner(brand_id)')
          .eq('id', chat.application_id)
          .single();

        if (appError || !application) {
          return res.status(404).json({
            success: false,
            message: 'Application not found'
          });
        }

        // Determine receiver ID
        const receiverId = userId === application.influencer_id
          ? application.v1_campaigns?.brand_id
          : application.influencer_id;

        // Validate file
        const validation = attachmentService.validateFile(fileBuffer, fileName, mimeType);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            message: validation.error
          });
        }

        // Upload attachment
        const uploadResult = await attachmentService.uploadAttachment(
          fileBuffer,
          fileName,
          validation.fileType,
          chatId, // Using chatId instead of conversationId
          userId
        );

        if (!uploadResult.success) {
          return res.status(500).json({
            success: false,
            message: uploadResult.error
          });
        }

        // Create message with attachment using ChatService
        const savedMessage = await ChatService.saveMessage(
          userId,
          chat.application_id,
          message || `📎 Sent ${fileName}`,
          uploadResult.attachment.url
        );

        // Update message with attachment metadata
        const { error: updateError } = await supabaseAdmin
          .from('v1_chat_messages')
          .update({
            attachment_metadata: {
              fileName: uploadResult.attachment.fileName,
              fileType: uploadResult.attachment.fileType,
              mimeType: uploadResult.attachment.mimeType,
              size: uploadResult.attachment.size,
              preview: attachmentService.getAttachmentPreview(uploadResult.attachment)
            }
          })
          .eq('id', savedMessage.id);

        if (updateError) {
          console.error('Error updating attachment metadata:', updateError);
        }

        // Get updated message with metadata
        const { data: updatedMessage } = await supabaseAdmin
          .from('v1_chat_messages')
          .select('*')
          .eq('id', savedMessage.id)
          .single();

        res.json({
          success: true,
          message: updatedMessage || savedMessage,
          attachment: uploadResult.attachment,
          preview: attachmentService.getAttachmentPreview(uploadResult.attachment)
        });

      } catch (error) {
        console.error('FormData upload error:', error);
        res.status(500).json({
          success: false,
          message: error.message || 'Internal server error'
        });
      }
    });

  } catch (error) {
    console.error('FormData parsing error:', error);
    if (error.message === 'Access denied to this chat') {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Delete attachment
 * DELETE /api/v1/chat/attachments/:attachmentId
 */
const deleteAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.user.id;

    // Get message with attachment details
    const { data: message, error: msgError } = await supabaseAdmin
      .from('v1_chat_messages')
      .select('id, sender_id, attachment_url, chat_id, v1_chats!inner(application_id)')
      .eq('id', attachmentId)
      .single();

    if (msgError || !message) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    // Check if user can delete this attachment (must be the sender)
    if (message.sender_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Can only delete your own attachments'
      });
    }

    // Delete from storage
    if (message.attachment_url) {
      const deleteResult = await attachmentService.deleteAttachment(message.attachment_url);
      if (!deleteResult.success) {
        console.error('Failed to delete attachment from storage:', deleteResult.error);
      }
    }

    // Update message to remove attachment
    const { error: updateError } = await supabaseAdmin
      .from('v1_chat_messages')
      .update({
        attachment_url: null,
        attachment_metadata: null
      })
      .eq('id', attachmentId);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete attachment'
      });
    }

    res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });

  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get attachment info
 * GET /api/v1/chat/attachments/:attachmentId
 */
const getAttachmentInfo = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.user.id;

    const { data: message, error } = await supabaseAdmin
      .from('v1_chat_messages')
      .select(`
        id, attachment_url, attachment_metadata, chat_id,
        v1_chats!inner(application_id)
      `)
      .eq('id', attachmentId)
      .single();

    if (error || !message) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    // Check if user has access to this chat
    const hasAccess = await ChatService.validateUserAccess(userId, message.v1_chats.application_id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (!message.attachment_url) {
      return res.status(404).json({
        success: false,
        message: 'No attachment found in this message'
      });
    }

    const attachmentInfo = {
      id: message.id,
      url: message.attachment_url,
      metadata: message.attachment_metadata,
      preview: message.attachment_metadata ?
        attachmentService.getAttachmentPreview(message.attachment_metadata) : null
    };

    res.json({
      success: true,
      attachment: attachmentInfo
    });

  } catch (error) {
    console.error('Get attachment info error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  getHistory,
  createChat,
  getChat,
  getUserChats,
  uploadAttachment,
  sendMessageWithAttachment,
  uploadWithFormData,
  deleteAttachment,
  getAttachmentInfo
};