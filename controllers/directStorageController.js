const { supabaseAdmin } = require('../supabase/client');
const storageService = require('../utils/directStorageService');

class DirectStorageController {
  /**
   * Upload file directly to storage and create message
   */
  async uploadAndSendMessage(req, res) {
    try {
      console.log('🔍 [DIRECT STORAGE DEBUG] uploadAndSendMessage called');
      console.log('🔍 [DIRECT STORAGE DEBUG] Request body keys:', Object.keys(req.body));
      console.log('🔍 [DIRECT STORAGE DEBUG] fileName:', req.body.fileName);
      console.log('🔍 [DIRECT STORAGE DEBUG] mimeType:', req.body.mimeType);
      console.log('🔍 [DIRECT STORAGE DEBUG] fileData length:', req.body.fileData ? req.body.fileData.length : 'undefined');
      
      const { conversation_id } = req.params;
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
      console.log('🔍 [DIRECT STORAGE DEBUG] Looking up conversation:', conversation_id);
      console.log('🔍 [DIRECT STORAGE DEBUG] User ID:', userId);
      
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('id, brand_owner_id, influencer_id')
        .eq('id', conversation_id)
        .single();

      console.log('🔍 [DIRECT STORAGE DEBUG] Conversation lookup result:');
      console.log('   - Error:', convError);
      console.log('   - Data:', conversation);

      if (convError) {
        console.log('❌ [DIRECT STORAGE DEBUG] Conversation lookup error:', convError);
        return res.status(404).json({
          success: false,
          message: 'Conversation not found',
          error: convError.message
        });
      }

      if (!conversation) {
        console.log('❌ [DIRECT STORAGE DEBUG] No conversation found with ID:', conversation_id);
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }

      if (conversation.brand_owner_id !== userId && conversation.influencer_id !== userId) {
        console.log('❌ [DIRECT STORAGE DEBUG] Access denied - User not in conversation');
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

      // Upload file directly to Supabase Storage
      const uploadResult = await storageService.uploadFileToStorage(
        fileBuffer,
        fileName,
        mimeType,
        conversation_id,
        userId
      );

      if (!uploadResult.success) {
        return res.status(400).json({
          success: false,
          message: uploadResult.error
        });
      }

      // Create message with file URL
      const { data: newMessage, error: msgError } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id,
          sender_id: userId,
          receiver_id: receiverId,
          message: message || `Sent a ${uploadResult.attachment.fileType}`,
          media_url: uploadResult.attachment.url,
          message_type: message_type,
          attachment_metadata: {
            fileName: uploadResult.attachment.fileName,
            fileType: uploadResult.attachment.fileType,
            mimeType: uploadResult.attachment.mimeType,
            size: uploadResult.attachment.size,
            preview: storageService.getFilePreview(uploadResult.attachment)
          }
        })
        .select()
        .single();

      if (msgError) {
        // Clean up uploaded file if message creation fails
        await storageService.deleteFileFromStorage(uploadResult.attachment.url);
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
          .select('id, chat_status, flow_state, awaiting_role, campaign_id, bid_id, current_action_data')
          .eq('id', conversation_id)
          .single();

        const context = conversationContext ? {
          id: conversationContext.id,
          chat_status: conversationContext.chat_status,
          flow_state: conversationContext.flow_state,
          awaiting_role: conversationContext.awaiting_role,
          conversation_type: conversationContext.campaign_id ? 'campaign' : 
                            conversationContext.bid_id ? 'bid' : 'direct',
          
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
        file: uploadResult.attachment,
        preview: storageService.getFilePreview(uploadResult.attachment)
      });

    } catch (error) {
      console.error('Upload and send message error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Delete file and message
   */
  async deleteFile(req, res) {
    try {
      const { message_id } = req.params;
      const userId = req.user.id;

      // Get message details
      const { data: message, error: msgError } = await supabaseAdmin
        .from('messages')
        .select('id, sender_id, media_url, conversation_id')
        .eq('id', message_id)
        .single();

      if (msgError || !message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      // Check if user can delete this file
      if (message.sender_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Can only delete your own files'
        });
      }

      // Delete from storage
      if (message.media_url) {
        const deleteResult = await storageService.deleteFileFromStorage(message.media_url);
        if (!deleteResult.success) {
          console.error('Failed to delete file from storage:', deleteResult.error);
        }
      }

      // Update message to remove file
      const { error: updateError } = await supabaseAdmin
        .from('messages')
        .update({
          media_url: null,
          attachment_metadata: null
        })
        .eq('id', message_id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to delete file'
        });
      }

      // Emit real-time update
      const io = req.app.get('io');
      if (io) {
        io.to(`conversation_${message.conversation_id}`).emit('file_deleted', {
          message_id: message_id,
          conversation_id: message.conversation_id,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: 'File deleted successfully'
      });

    } catch (error) {
      console.error('Delete file error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get file info
   */
  async getFileInfo(req, res) {
    try {
      const { message_id } = req.params;
      const userId = req.user.id;

      const { data: message, error } = await supabaseAdmin
        .from('messages')
        .select(`
          id, media_url, attachment_metadata, conversation_id,
          conversations!inner(brand_owner_id, influencer_id)
        `)
        .eq('id', message_id)
        .single();

      if (error || !message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
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
          message: 'No file found in this message'
        });
      }

      const fileInfo = {
        id: message.id,
        url: message.media_url,
        metadata: message.attachment_metadata,
        preview: message.attachment_metadata ? 
          storageService.getFilePreview(message.attachment_metadata) : null
      };

      res.json({
        success: true,
        file: fileInfo
      });

    } catch (error) {
      console.error('Get file info error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  /**
   * Get supported file types
   */
  async getSupportedTypes(req, res) {
    try {
      res.json({
        success: true,
        fileTypes: storageService.FILE_TYPES
      });
    } catch (error) {
      console.error('Get supported types error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

module.exports = new DirectStorageController();