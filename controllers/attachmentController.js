const { supabaseAdmin } = require('../supabase/client');
const attachmentService = require('../utils/attachmentService');
const multiparty = require('multiparty');

class AttachmentController {
  /**
   * Upload attachment for a conversation
   */
  async uploadAttachment(req, res) {
    try {
      console.log('🔍 [ATTACHMENT DEBUG] uploadAttachment called');
      console.log('🔍 [ATTACHMENT DEBUG] Request body keys:', Object.keys(req.body));
      console.log('🔍 [ATTACHMENT DEBUG] fileName:', req.body.fileName);
      console.log('🔍 [ATTACHMENT DEBUG] mimeType:', req.body.mimeType);
      console.log('🔍 [ATTACHMENT DEBUG] fileData length:', req.body.fileData ? req.body.fileData.length : 'undefined');

      const { conversation_id } = req.params;
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

      // Verify conversation exists and user has access
      console.log('🔍 [ATTACHMENT DEBUG] Looking up conversation:', conversation_id);
      console.log('🔍 [ATTACHMENT DEBUG] User ID:', userId);

      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('id, brand_owner_id, influencer_id')
        .eq('id', conversation_id)
        .single();

      console.log('🔍 [ATTACHMENT DEBUG] Conversation lookup result:');
      console.log('   - Error:', convError);
      console.log('   - Data:', conversation);

      if (convError) {
        console.log('❌ [ATTACHMENT DEBUG] Conversation lookup error:', convError);
        return res.status(404).json({
          success: false,
          message: 'Conversation not found',
          error: convError.message
        });
      }

      if (!conversation) {
        console.log('❌ [ATTACHMENT DEBUG] No conversation found with ID:', conversation_id);
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }

      if (conversation.brand_owner_id !== userId && conversation.influencer_id !== userId) {
        console.log('❌ [ATTACHMENT DEBUG] Access denied - User not in conversation');
        console.log('   - Brand Owner ID:', conversation.brand_owner_id);
        console.log('   - Influencer ID:', conversation.influencer_id);
        console.log('   - User ID:', userId);
        return res.status(403).json({
          success: false,
          message: 'Access denied to this conversation'
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

      // Upload attachment
      const result = await attachmentService.uploadAttachment(
        fileBuffer,
        fileName,
        validation.fileType,
        conversation_id,
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
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Upload with FormData (for Android content URIs)
   */
  async uploadWithFormData(req, res) {
    try {
      console.log('🔍 [FORMDATA DEBUG] uploadWithFormData called');

      const { conversation_id } = req.params;
      const userId = req.user.id;

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

        console.log('🔍 [FORMDATA DEBUG] Parsed fields:', fields);
        console.log('🔍 [FORMDATA DEBUG] Parsed files:', files);

        const message = fields.message ? fields.message[0] : '';
        const message_type = fields.message_type ? fields.message_type[0] : 'user_input';

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

        console.log('🔍 [FORMDATA DEBUG] File details:', {
          fileName,
          mimeType,
          size: fileBuffer.length
        });

        // Clean up temporary file
        try {
          fs.unlinkSync(file.path);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary file:', cleanupError.message);
        }

        try {
          // Verify conversation exists and user has access
          const { data: conversation, error: convError } = await supabaseAdmin
            .from('conversations')
            .select('id, brand_owner_id, influencer_id')
            .eq('id', conversation_id)
            .single();

          if (convError || !conversation) {
            return res.status(404).json({
              success: false,
              message: 'Conversation not found'
            });
          }

          if (conversation.brand_owner_id !== userId && conversation.influencer_id !== userId) {
            return res.status(403).json({
              success: false,
              message: 'Access denied to this conversation'
            });
          }

          // Determine receiver ID
          const receiverId = conversation.brand_owner_id === userId
            ? conversation.influencer_id
            : conversation.brand_owner_id;

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
            conversation_id,
            userId
          );

          if (!uploadResult.success) {
            return res.status(500).json({
              success: false,
              message: uploadResult.error
            });
          }

          // Create message with attachment
          const { data: newMessage, error: msgError } = await supabaseAdmin
            .from('messages')
            .insert({
              conversation_id,
              sender_id: userId,
              receiver_id: receiverId,
              message: message || `📎 Sent ${fileName}`,
              media_url: uploadResult.attachment.url,
              message_type: message_type,
              attachment_metadata: {
                fileName: uploadResult.attachment.fileName,
                fileType: uploadResult.attachment.fileType,
                mimeType: uploadResult.attachment.mimeType,
                size: uploadResult.attachment.size,
                preview: attachmentService.getAttachmentPreview(uploadResult.attachment)
              }
            })
            .select()
            .single();

          if (msgError) {
            await attachmentService.deleteAttachment(uploadResult.attachment.url);
            return res.status(500).json({
              success: false,
              message: 'Failed to create message'
            });
          }

          // Update conversation timestamp
          await supabaseAdmin
            .from('conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversation_id);

          // Emit real-time update
          const io = req.app.get('io');
          if (io) {
            // Get conversation context
            const { data: conversationContext } = await supabaseAdmin
              .from('conversations')
              .select('id, chat_status, flow_state, awaiting_role, campaign_id, current_action_data')
              .eq('id', conversation_id)
              .single();

            const context = conversationContext ? {
              id: conversationContext.id,
              chat_status: conversationContext.chat_status,
              flow_state: conversationContext.flow_state,
              awaiting_role: conversationContext.awaiting_role,
              conversation_type: conversationContext.campaign_id ? 'campaign' : 'direct',

              current_action_data: conversationContext.current_action_data
            } : null;

            // Emit to conversation room
            io.to(`conversation_${conversation_id}`).emit('new_message', {
              conversation_id,
              message: newMessage,
              conversation_context: context
            });

            // Emit notification to receiver
            io.to(`user_${receiverId}`).emit('notification', {
              type: 'message',
              data: {
                id: newMessage.id,
                title: `${req.user.name} sent a file`,
                body: newMessage.message,
                created_at: newMessage.created_at,
                conversation_context: context,
                payload: {
                  conversation_id,
                  message_id: newMessage.id,
                  sender_id: userId
                },
                conversation_id,
                message: newMessage,
                sender_id: userId,
                receiver_id: receiverId
              }
            });
          }

          res.json({
            success: true,
            message: newMessage,
            attachment: uploadResult.attachment,
            preview: attachmentService.getAttachmentPreview(uploadResult.attachment)
          });

        } catch (error) {
          console.error('FormData upload error:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error'
          });
        }
      });

    } catch (error) {
      console.error('FormData parsing error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Send message with attachment
   */
  async sendMessageWithAttachment(req, res) {
    try {
      console.log('🔍 [ATTACHMENT DEBUG] sendMessageWithAttachment called');
      console.log('🔍 [ATTACHMENT DEBUG] Request params:', req.params);
      console.log('🔍 [ATTACHMENT DEBUG] Request body keys:', Object.keys(req.body));
      console.log('🔍 [ATTACHMENT DEBUG] fileName:', req.body.fileName);
      console.log('🔍 [ATTACHMENT DEBUG] mimeType:', req.body.mimeType);
      console.log('🔍 [ATTACHMENT DEBUG] fileData length:', req.body.fileData ? req.body.fileData.length : 'undefined');

      const { conversation_id } = req.params;
      console.log('🔍 [ATTACHMENT DEBUG] conversation_id from params:', conversation_id);
      const { message, message_type = 'user_input', fileName, mimeType, fileData } = req.body;
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

      // Verify conversation exists and user has access
      console.log('🔍 [ATTACHMENT DEBUG] Looking up conversation:', conversation_id);
      console.log('🔍 [ATTACHMENT DEBUG] User ID:', userId);

      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('id, brand_owner_id, influencer_id')
        .eq('id', conversation_id)
        .single();

      console.log('🔍 [ATTACHMENT DEBUG] Conversation lookup result:');
      console.log('   - Error:', convError);
      console.log('   - Data:', conversation);

      if (convError) {
        console.log('❌ [ATTACHMENT DEBUG] Conversation lookup error:', convError);
        return res.status(404).json({
          success: false,
          message: 'Conversation not found',
          error: convError.message
        });
      }

      if (!conversation) {
        console.log('❌ [ATTACHMENT DEBUG] No conversation found with ID:', conversation_id);
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }

      if (conversation.brand_owner_id !== userId && conversation.influencer_id !== userId) {
        console.log('❌ [ATTACHMENT DEBUG] Access denied - User not in conversation');
        console.log('   - Brand Owner ID:', conversation.brand_owner_id);
        console.log('   - Influencer ID:', conversation.influencer_id);
        console.log('   - User ID:', userId);
        return res.status(403).json({
          success: false,
          message: 'Access denied to this conversation'
        });
      }

      // Determine receiver ID
      const receiverId = conversation.brand_owner_id === userId
        ? conversation.influencer_id
        : conversation.brand_owner_id;

      // Validate file
      console.log('🔍 [ATTACHMENT DEBUG] Validating file...');
      console.log('🔍 [ATTACHMENT DEBUG] File buffer size:', fileBuffer.length);
      console.log('🔍 [ATTACHMENT DEBUG] File name:', fileName);
      console.log('🔍 [ATTACHMENT DEBUG] MIME type:', mimeType);

      const validation = attachmentService.validateFile(fileBuffer, fileName, mimeType);
      console.log('🔍 [ATTACHMENT DEBUG] Validation result:', validation);

      if (!validation.valid) {
        console.log('❌ [ATTACHMENT DEBUG] File validation failed:', validation.error);
        return res.status(400).json({
          success: false,
          message: validation.error
        });
      }

      console.log('✅ [ATTACHMENT DEBUG] File validation passed');

      // Upload attachment
      console.log('🔍 [ATTACHMENT DEBUG] Starting file upload...');
      const uploadResult = await attachmentService.uploadAttachment(
        fileBuffer,
        fileName,
        validation.fileType,
        conversation_id,
        userId
      );

      console.log('🔍 [ATTACHMENT DEBUG] Upload result:', uploadResult);

      if (!uploadResult.success) {
        console.log('❌ [ATTACHMENT DEBUG] Upload failed:', uploadResult.error);
        return res.status(500).json({
          success: false,
          message: uploadResult.error
        });
      }

      console.log('✅ [ATTACHMENT DEBUG] Upload successful');

      // Create message with attachment
      console.log('🔍 [ATTACHMENT DEBUG] Creating message...');
      console.log('🔍 [ATTACHMENT DEBUG] Message data:', {
        conversation_id,
        sender_id: userId,
        receiver_id: receiverId,
        message: message || `Sent a ${validation.fileType}`,
        media_url: uploadResult.attachment.url,
        message_type: message_type
      });

      const { data: newMessage, error: msgError } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id,
          sender_id: userId,
          receiver_id: receiverId,
          message: message || `📎 Sent ${fileName}`,
          media_url: uploadResult.attachment.url,
          message_type: message_type,
          attachment_metadata: {
            fileName: uploadResult.attachment.fileName,
            fileType: uploadResult.attachment.fileType,
            mimeType: uploadResult.attachment.mimeType,
            size: uploadResult.attachment.size,
            preview: attachmentService.getAttachmentPreview(uploadResult.attachment)
          }
        })
        .select()
        .single();

      console.log('🔍 [ATTACHMENT DEBUG] Message creation result:');
      console.log('   - Error:', msgError);
      console.log('   - Data:', newMessage);

      if (msgError) {
        console.log('❌ [ATTACHMENT DEBUG] Message creation failed:', msgError);
        // Clean up uploaded file if message creation fails
        await attachmentService.deleteAttachment(uploadResult.attachment.url);
        return res.status(500).json({
          success: false,
          message: 'Failed to create message'
        });
      }

      console.log('✅ [ATTACHMENT DEBUG] Message created successfully');

      // Update conversation timestamp
      await supabaseAdmin
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversation_id);

      // Emit real-time update
      const io = req.app.get('io');
      console.log('🔍 [ATTACHMENT DEBUG] Socket IO available:', !!io);
      console.log('🔍 [ATTACHMENT DEBUG] Socket IO type:', typeof io);
      console.log('🔍 [ATTACHMENT DEBUG] Socket IO methods:', io ? Object.getOwnPropertyNames(Object.getPrototypeOf(io)) : 'N/A');
      if (io) {
        console.log('🔍 [ATTACHMENT DEBUG] Emitting real-time updates...');
        // Get conversation context
        const { data: conversationContext } = await supabaseAdmin
          .from('conversations')
          .select('id, chat_status, flow_state, awaiting_role, campaign_id, current_action_data')
          .eq('id', conversation_id)
          .single();

        const context = conversationContext ? {
          id: conversationContext.id,
          chat_status: conversationContext.chat_status,
          flow_state: conversationContext.flow_state,
          awaiting_role: conversationContext.awaiting_role,
          conversation_type: conversationContext.campaign_id ? 'campaign' : 'direct',

          current_action_data: conversationContext.current_action_data
        } : null;

        // Emit to conversation room
        console.log('🔍 [ATTACHMENT DEBUG] Emitting to conversation room:', `conversation_${conversation_id}`);
        const messageData = {
          conversation_id,
          message: newMessage,
          conversation_context: context
        };
        console.log('🔍 [ATTACHMENT DEBUG] Message data being emitted:', JSON.stringify(messageData, null, 2));
        io.to(`conversation_${conversation_id}`).emit('new_message', messageData);

        // Emit notification to receiver
        console.log('🔍 [ATTACHMENT DEBUG] Emitting notification to user:', `user_${receiverId}`);
        io.to(`user_${receiverId}`).emit('notification', {
          type: 'message',
          data: {
            id: newMessage.id,
            title: `${req.user.name} sent an attachment`,
            body: newMessage.message,
            created_at: newMessage.created_at,
            conversation_context: context,
            payload: {
              conversation_id,
              message_id: newMessage.id,
              sender_id: userId
            },
            conversation_id,
            message: newMessage,
            sender_id: userId,
            receiver_id: receiverId
          }
        });

        // Emit conversation list updates
        io.to(`user_${userId}`).emit('conversation_list_updated', {
          conversation_id,
          message: newMessage,
          conversation_context: context,
          action: 'message_sent',
          timestamp: new Date().toISOString()
        });

        io.to(`user_${receiverId}`).emit('conversation_list_updated', {
          conversation_id,
          message: newMessage,
          conversation_context: context,
          action: 'message_received',
          timestamp: new Date().toISOString()
        });

        // Emit unread count update
        io.to(`user_${receiverId}`).emit('unread_count_updated', {
          conversation_id,
          unread_count: 1,
          action: 'increment',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: newMessage,
        attachment: uploadResult.attachment,
        preview: attachmentService.getAttachmentPreview(uploadResult.attachment)
      });

    } catch (error) {
      console.error('Send message with attachment error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Delete attachment
   */
  async deleteAttachment(req, res) {
    try {
      const { attachment_id } = req.params;
      const userId = req.user.id;

      // Get attachment details
      const { data: message, error: msgError } = await supabaseAdmin
        .from('messages')
        .select('id, sender_id, media_url, conversation_id')
        .eq('id', attachment_id)
        .single();

      if (msgError || !message) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found'
        });
      }

      // Check if user can delete this attachment
      if (message.sender_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Can only delete your own attachments'
        });
      }

      // Delete from storage
      if (message.media_url) {
        const deleteResult = await attachmentService.deleteAttachment(message.media_url);
        if (!deleteResult.success) {
          console.error('Failed to delete attachment from storage:', deleteResult.error);
        }
      }

      // Update message to remove attachment
      const { error: updateError } = await supabaseAdmin
        .from('messages')
        .update({
          media_url: null,
          attachment_metadata: null
        })
        .eq('id', attachment_id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to delete attachment'
        });
      }

      // Emit real-time update
      const io = req.app.get('io');
      if (io) {
        io.to(`conversation_${message.conversation_id}`).emit('attachment_deleted', {
          message_id: attachment_id,
          conversation_id: message.conversation_id,
          timestamp: new Date().toISOString()
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
  }

  /**
   * Get attachment info
   */
  async getAttachmentInfo(req, res) {
    try {
      const { attachment_id } = req.params;
      const userId = req.user.id;

      const { data: message, error } = await supabaseAdmin
        .from('messages')
        .select(`
          id, media_url, attachment_metadata, conversation_id,
          conversations!inner(brand_owner_id, influencer_id)
        `)
        .eq('id', attachment_id)
        .single();

      if (error || !message) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found'
        });
      }

      // Check if user has access to this conversation
      if (message.conversations.brand_owner_id !== userId &&
        message.conversations.influencer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      if (!message.media_url) {
        return res.status(404).json({
          success: false,
          message: 'No attachment found in this message'
        });
      }

      const attachmentInfo = {
        id: message.id,
        url: message.media_url,
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
  }
}

module.exports = new AttachmentController();