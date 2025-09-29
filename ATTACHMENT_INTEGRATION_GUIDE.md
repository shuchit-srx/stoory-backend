# 📎 Attachment System Integration Guide

## 🎯 Overview

This guide covers the complete attachment system implementation for your realtime chat application, supporting images, videos, documents, and audio files with realtime progress indicators and previews.

## 🏗️ Backend Implementation

### 1. Database Schema

The system uses the existing `messages` table with an additional `attachment_metadata` column:

```sql
-- Messages table structure
CREATE TABLE messages (
    id UUID PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id),
    sender_id UUID REFERENCES users(id),
    receiver_id UUID REFERENCES users(id),
    message TEXT,
    media_url TEXT,                    -- URL to the attachment
    attachment_metadata JSONB,         -- Detailed attachment info
    seen BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 2. Supported File Types

| Type | Extensions | Max Size | MIME Types |
|------|------------|----------|------------|
| **Images** | .jpg, .jpeg, .png, .gif, .webp, .bmp, .svg | 1GB | image/* |
| **Videos** | .mp4, .mov, .avi, .mkv, .webm, .m4v | 1GB | video/* |
| **Documents** | .pdf, .doc, .docx, .txt, .rtf, .odt, .xls, .xlsx, .ppt, .pptx | 500MB | application/*, text/* |
| **Audio** | .mp3, .wav, .ogg, .m4a, .aac, .flac | 200MB | audio/* |

### 3. API Endpoints

#### Upload Attachment
```http
POST /api/attachments/conversations/:conversation_id/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>

Form Data:
- file: <file>
```

#### Send Message with Attachment
```http
POST /api/attachments/conversations/:conversation_id/send-with-attachment
Content-Type: multipart/form-data
Authorization: Bearer <token>

Form Data:
- file: <file>
- message: "Optional message text"
- message_type: "user_input"
```

#### Delete Attachment
```http
DELETE /api/attachments/attachments/:attachment_id
Authorization: Bearer <token>
```

#### Get Attachment Info
```http
GET /api/attachments/attachments/:attachment_id
Authorization: Bearer <token>
```

### 4. Socket Events

#### Client → Server Events

```javascript
// Send message with attachment
socket.emit('send_message', {
  conversationId: 'uuid',
  senderId: 'uuid',
  receiverId: 'uuid',
  message: 'Check out this file!',
  mediaUrl: 'https://storage.supabase.co/attachments/...',
  attachmentMetadata: {
    fileName: 'document.pdf',
    fileType: 'document',
    mimeType: 'application/pdf',
    size: 1024000,
    preview: { /* preview data */ }
  }
});

// Upload progress
socket.emit('attachment_upload_progress', {
  conversationId: 'uuid',
  progress: 50,
  fileName: 'video.mp4'
});

// Upload complete
socket.emit('attachment_upload_complete', {
  conversationId: 'uuid',
  attachment: { /* attachment data */ },
  fileName: 'video.mp4'
});

// Upload error
socket.emit('attachment_upload_error', {
  conversationId: 'uuid',
  error: 'File too large',
  fileName: 'video.mp4'
});
```

#### Server → Client Events

```javascript
// New message with attachment
socket.on('new_message', (data) => {
  // data.message.attachment_metadata contains attachment info
  // data.message.media_url contains the file URL
});

// Upload progress update
socket.on('attachment_upload_progress', (data) => {
  // Update progress bar
  updateProgressBar(data.progress, data.fileName);
});

// Upload complete
socket.on('attachment_upload_complete', (data) => {
  // Show attachment preview
  showAttachmentPreview(data.attachment);
});

// Upload error
socket.on('attachment_upload_error', (data) => {
  // Show error message
  showError(data.error, data.fileName);
});

// Attachment deleted
socket.on('attachment_deleted', (data) => {
  // Remove attachment from UI
  removeAttachment(data.message_id);
});
```

## 🎨 Frontend Implementation

### 1. React Hook for Attachments

```javascript
// hooks/useAttachments.js
import { useState, useCallback } from 'react';
import { useSocket } from './useSocket';

export const useAttachments = (conversationId, userId) => {
  const { socket } = useSocket(userId);
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadingFiles, setUploadingFiles] = useState(new Set());

  const uploadAttachment = useCallback(async (file, message = '') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('message', message);
    formData.append('message_type', 'user_input');

    try {
      setUploadingFiles(prev => new Set([...prev, file.name]));
      
      const response = await fetch(`/api/attachments/conversations/${conversationId}/send-with-attachment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      const result = await response.json();
      
      if (result.success) {
        // Emit socket event for realtime updates
        socket.emit('send_message', {
          conversationId,
          senderId: userId,
          receiverId: result.message.receiver_id,
          message: result.message.message,
          mediaUrl: result.message.media_url,
          attachmentMetadata: result.message.attachment_metadata
        });
      }
      
      return result;
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    } finally {
      setUploadingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.name);
        return newSet;
      });
    }
  }, [conversationId, userId, socket]);

  const deleteAttachment = useCallback(async (attachmentId) => {
    try {
      const response = await fetch(`/api/attachments/attachments/${attachmentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      return await response.json();
    } catch (error) {
      console.error('Delete error:', error);
      throw error;
    }
  }, []);

  return {
    uploadAttachment,
    deleteAttachment,
    uploadProgress,
    uploadingFiles
  };
};
```

### 2. Attachment Preview Component

```javascript
// components/AttachmentPreview.jsx
import React from 'react';

const AttachmentPreview = ({ attachment, onDelete, canDelete = false }) => {
  const { preview, url, fileName, fileType, size } = attachment;

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderPreview = () => {
    if (fileType === 'image') {
      return (
        <img 
          src={url} 
          alt={fileName}
          className="max-w-full max-h-64 rounded-lg object-contain"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
      );
    }
    
    if (fileType === 'video') {
      return (
        <video 
          src={url} 
          controls 
          className="max-w-full max-h-64 rounded-lg"
          preload="metadata"
        >
          Your browser does not support the video tag.
        </video>
      );
    }
    
    if (fileType === 'audio') {
      return (
        <audio 
          src={url} 
          controls 
          className="w-full"
          preload="metadata"
        >
          Your browser does not support the audio tag.
        </audio>
      );
    }
    
    // Document or other file types
    return (
      <div className="flex items-center p-4 bg-gray-100 rounded-lg">
        <span className="text-2xl mr-3">{preview?.icon || '📎'}</span>
        <div className="flex-1">
          <p className="font-medium text-gray-900">{fileName}</p>
          <p className="text-sm text-gray-500">{formatFileSize(size)}</p>
        </div>
        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="ml-2 text-blue-600 hover:text-blue-800"
        >
          Download
        </a>
      </div>
    );
  };

  return (
    <div className="attachment-preview relative group">
      {renderPreview()}
      
      {canDelete && (
        <button
          onClick={() => onDelete(attachment.id)}
          className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete attachment"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default AttachmentPreview;
```

### 3. File Upload Component

```javascript
// components/FileUpload.jsx
import React, { useRef, useState } from 'react';

const FileUpload = ({ onFileSelect, onUpload, uploading = false }) => {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFileSelect = (files) => {
    Array.from(files).forEach(file => {
      // Validate file type and size
      if (validateFile(file)) {
        onFileSelect(file);
      }
    });
  };

  const validateFile = (file) => {
    const maxSizes = {
      image: 1024 * 1024 * 1024,    // 1GB
      video: 1024 * 1024 * 1024,    // 1GB
      document: 500 * 1024 * 1024,  // 500MB
      audio: 200 * 1024 * 1024      // 200MB
    };

    const fileType = getFileType(file);
    if (!fileType) {
      alert('Unsupported file type');
      return false;
    }

    if (file.size > maxSizes[fileType]) {
      alert(`File too large. Max size for ${fileType} files: ${maxSizes[fileType] / (1024 * 1024)}MB`);
      return false;
    }

    return true;
  };

  const getFileType = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const mimeType = file.type;

    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('application/') || mimeType.startsWith('text/')) return 'document';
    
    return null;
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files);
    }
  };

  const handleChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files);
    }
  };

  return (
    <div
      className={`file-upload-area border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
        dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
      } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleChange}
        className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.rtf,.odt,.xls,.xlsx,.ppt,.pptx"
      />
      
      <div className="space-y-2">
        <div className="text-4xl">📎</div>
        <p className="text-lg font-medium">
          {dragActive ? 'Drop files here' : 'Upload attachments'}
        </p>
        <p className="text-sm text-gray-500">
          Images, videos, documents, and audio files
        </p>
        <p className="text-xs text-gray-400">
          Max sizes: Images 1GB, Videos 1GB, Documents 500MB, Audio 200MB
        </p>
      </div>
      
      <button
        onClick={() => fileInputRef.current?.click()}
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        disabled={uploading}
      >
        {uploading ? 'Uploading...' : 'Choose Files'}
      </button>
    </div>
  );
};

export default FileUpload;
```

### 4. Enhanced Chat Window with Attachments

```javascript
// components/ChatWindowWithAttachments.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useAttachments } from '../hooks/useAttachments';
import AttachmentPreview from './AttachmentPreview';
import FileUpload from './FileUpload';

const ChatWindowWithAttachments = ({ conversation, currentUserId }) => {
  const { socket } = useSocket(currentUserId);
  const { uploadAttachment, deleteAttachment, uploadingFiles } = useAttachments(conversation.id, currentUserId);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!socket || !conversation) return;

    // Join conversation room
    socket.emit('join_conversation', conversation.id);

    // Listen for new messages
    const handleNewMessage = (data) => {
      if (data.conversation_id === conversation.id) {
        setMessages(prev => [...prev, data.message]);
      }
    };

    // Listen for attachment events
    const handleAttachmentProgress = (data) => {
      if (data.conversationId === conversation.id) {
        // Update progress indicator
        console.log(`Upload progress for ${data.fileName}: ${data.progress}%`);
      }
    };

    const handleAttachmentComplete = (data) => {
      if (data.conversationId === conversation.id) {
        console.log(`Upload complete for ${data.fileName}`);
      }
    };

    const handleAttachmentError = (data) => {
      if (data.conversationId === conversation.id) {
        console.error(`Upload error for ${data.fileName}:`, data.error);
        alert(`Upload failed: ${data.error}`);
      }
    };

    socket.on('new_message', handleNewMessage);
    socket.on('attachment_upload_progress', handleAttachmentProgress);
    socket.on('attachment_upload_complete', handleAttachmentComplete);
    socket.on('attachment_upload_error', handleAttachmentError);

    return () => {
      socket.emit('leave_conversation', conversation.id);
      socket.off('new_message', handleNewMessage);
      socket.off('attachment_upload_progress', handleAttachmentProgress);
      socket.off('attachment_upload_complete', handleAttachmentComplete);
      socket.off('attachment_upload_error', handleAttachmentError);
    };
  }, [socket, conversation]);

  const handleFileSelect = (file) => {
    setSelectedFiles(prev => [...prev, file]);
  };

  const handleUploadFiles = async () => {
    for (const file of selectedFiles) {
      try {
        await uploadAttachment(file, newMessage || `Sent a ${file.name}`);
      } catch (error) {
        console.error('Upload failed:', error);
      }
    }
    setSelectedFiles([]);
    setNewMessage('');
    setShowFileUpload(false);
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || !socket) return;

    socket.emit('send_message', {
      conversationId: conversation.id,
      senderId: currentUserId,
      receiverId: conversation.other_user_id,
      message: newMessage.trim()
    });

    setNewMessage('');
  };

  const handleDeleteAttachment = async (attachmentId) => {
    try {
      await deleteAttachment(attachmentId);
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  return (
    <div className="chat-window h-full flex flex-col">
      {/* Chat Header */}
      <div className="chat-header p-4 border-b">
        <h2>{conversation.other_user.name}</h2>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowFileUpload(!showFileUpload)}
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
          >
            📎 Attach
          </button>
        </div>
      </div>

      {/* File Upload Area */}
      {showFileUpload && (
        <div className="p-4 border-b">
          <FileUpload
            onFileSelect={handleFileSelect}
            uploading={uploadingFiles.size > 0}
          />
          
          {selectedFiles.length > 0 && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">Selected Files:</h4>
              <div className="space-y-2">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-gray-100 rounded">
                    <span className="text-sm">{file.name}</span>
                    <button
                      onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== index))}
                      className="text-red-500 hover:text-red-700"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex space-x-2">
                <button
                  onClick={handleUploadFiles}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                  disabled={uploadingFiles.size > 0}
                >
                  Upload {selectedFiles.length} file(s)
                </button>
                <button
                  onClick={() => {
                    setSelectedFiles([]);
                    setShowFileUpload(false);
                  }}
                  className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="messages-container flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`message ${message.sender_id === currentUserId ? 'sent' : 'received'}`}
          >
            <div className="message-content">
              <p className="message-text">{message.message}</p>
              
              {message.media_url && message.attachment_metadata && (
                <div className="mt-2">
                  <AttachmentPreview
                    attachment={{
                      id: message.id,
                      url: message.media_url,
                      ...message.attachment_metadata
                    }}
                    onDelete={handleDeleteAttachment}
                    canDelete={message.sender_id === currentUserId}
                  />
                </div>
              )}
            </div>
            <div className="message-time text-xs text-gray-500">
              {new Date(message.created_at).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>

      {/* Message Input */}
      <div className="message-input p-4 border-t">
        <div className="flex space-x-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') handleSendMessage();
            }}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSendMessage}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatWindowWithAttachments;
```

## 🚀 Setup Instructions

### 1. Backend Setup

1. **Run the database migration:**
   ```sql
   -- Run this in your Supabase SQL editor
   \i database/add_attachment_metadata.sql
   ```

2. **Add the attachment routes to your main app:**
   ```javascript
   // In your main index.js or app.js
   const attachmentRoutes = require('./routes/attachments');
   app.use('/api/attachments', attachmentRoutes);
   ```

3. **Create the attachments bucket in Supabase Storage:**
   - Go to Supabase Dashboard → Storage
   - Create a new bucket named "attachments"
   - Set appropriate policies for public access

### 2. Frontend Setup

1. **Install required dependencies:**
   ```bash
   npm install socket.io-client
   ```

2. **Add the components to your React app:**
   - Copy the provided components to your components folder
   - Copy the hooks to your hooks folder
   - Update your chat components to use the new attachment functionality

### 3. Environment Variables

Make sure your environment variables are set:
```bash
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 🔧 Configuration

### File Size Limits
You can adjust file size limits in `utils/attachmentService.js`:

```javascript
const FILE_TYPES = {
  image: { maxSize: 1024 * 1024 * 1024 },    // 1GB
  video: { maxSize: 1024 * 1024 * 1024 },    // 1GB
  document: { maxSize: 500 * 1024 * 1024 },  // 500MB
  audio: { maxSize: 200 * 1024 * 1024 }      // 200MB
};
```

### Supported File Types
Add or remove file types by modifying the `FILE_TYPES` configuration in `attachmentService.js`.

## 🎯 Features

✅ **Multiple File Types**: Images, videos, documents, and audio files  
✅ **Realtime Progress**: Upload progress indicators via Socket.IO  
✅ **File Validation**: Type and size validation  
✅ **Preview Support**: Image and video previews  
✅ **Error Handling**: Comprehensive error handling and user feedback  
✅ **Security**: File type validation and size limits  
✅ **Storage**: Supabase Storage integration  
✅ **Realtime Updates**: Live attachment sharing via Socket.IO  
✅ **Delete Support**: Ability to delete attachments  
✅ **Metadata**: Rich attachment metadata storage  

## 🚨 Security Considerations

1. **File Validation**: Always validate file types and sizes on both client and server
2. **Storage Policies**: Configure appropriate Supabase Storage policies
3. **Access Control**: Ensure users can only access attachments from their conversations
4. **Virus Scanning**: Consider implementing virus scanning for uploaded files
5. **Rate Limiting**: Implement rate limiting for file uploads

## 📱 Mobile Considerations

- Use appropriate file picker components for mobile
- Consider compression for large images on mobile
- Implement proper touch interactions for file selection
- Test upload performance on slower mobile connections

This attachment system provides a complete solution for handling file attachments in your realtime chat application with proper validation, security, and user experience considerations.
