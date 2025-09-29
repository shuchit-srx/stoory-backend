# Frontend Media Display Guide

This guide covers how the frontend should display shared media in messages, including all file types and display scenarios.

## 📋 Table of Contents
1. [Message Data Structure](#message-data-structure)
2. [Media Display Components](#media-display-components)
3. [File Type Handling](#file-type-handling)
4. [Display Scenarios](#display-scenarios)
5. [Real-time Updates](#real-time-updates)
6. [Error Handling](#error-handling)
7. [Implementation Examples](#implementation-examples)

## 📊 Message Data Structure

### Complete Message Object
```json
{
  "id": "542cf10c-cebe-4a73-bcef-7da62b133df8",
  "conversation_id": "f031894f-cc4e-4a3d-a907-fcaa5160d4f1",
  "sender_id": "ec248800-859e-4ce8-981e-8e4d82c078ff",
  "receiver_id": "6c23b5d0-51bc-4992-8ffd-b2b1ce14795e",
  "message": "📎 Sent image.jpg",
  "media_url": "https://exqnyaiedqoauehmzltj.supabase.co/storage/v1/object/public/attachments/chat-images/1759060954156_fb770f0bc4fb16b7_8479.jpg",
  "seen": false,
  "created_at": "2025-09-28T12:02:34.657611+00:00",
  "message_type": "user_input",
  "action_required": false,
  "action_data": null,
  "is_automated": false,
  "action_completed": false,
  "status": "sent",
  "updated_at": "2025-09-28T12:02:34.657611+00:00",
  "attachment_metadata": {
    "fileName": "image.jpg",
    "fileType": "image",
    "mimeType": "image/jpeg",
    "size": 171024,
    "preview": {
      "url": "https://exqnyaiedqoauehmzltj.supabase.co/storage/v1/object/public/attachments/chat-images/1759060954156_fb770f0bc4fb16b7_8479.jpg",
      "icon": "🖼️",
      "size": 171024,
      "type": "image",
      "fileName": "image.jpg",
      "thumbnail": "https://exqnyaiedqoauehmzltj.supabase.co/storage/v1/object/public/attachments/chat-images/1759060954156_fb770f0bc4fb16b7_8479.jpg",
      "canPreview": true
    }
  }
}
```

## 🎨 Media Display Components

### 1. Message Container
```jsx
const MessageContainer = ({ message, isOwn, onMediaClick }) => {
  const hasMedia = message.media_url && message.attachment_metadata;
  
  return (
    <div className={`message ${isOwn ? 'own' : 'other'}`}>
      {/* Text Message (if exists) */}
      {message.message && (
        <div className="message-text">
          {message.message}
        </div>
      )}
      
      {/* Media Attachment */}
      {hasMedia && (
        <MediaAttachment 
          metadata={message.attachment_metadata}
          mediaUrl={message.media_url}
          onMediaClick={onMediaClick}
        />
      )}
      
      {/* Timestamp */}
      <div className="message-time">
        {formatTime(message.created_at)}
      </div>
    </div>
  );
};
```

### 2. Media Attachment Component
```jsx
const MediaAttachment = ({ metadata, mediaUrl, onMediaClick }) => {
  const { fileType, fileName, size, preview } = metadata;
  
  const handleClick = () => {
    if (onMediaClick) {
      onMediaClick({
        url: mediaUrl,
        type: fileType,
        fileName: fileName,
        metadata: metadata
      });
    }
  };
  
  return (
    <div className="media-attachment" onClick={handleClick}>
      {fileType === 'image' && <ImagePreview preview={preview} />}
      {fileType === 'video' && <VideoPreview preview={preview} />}
      {fileType === 'audio' && <AudioPreview preview={preview} />}
      {fileType === 'document' && <DocumentPreview preview={preview} />}
    </div>
  );
};
```

## 📁 File Type Handling

### 1. Image Files
```jsx
const ImagePreview = ({ preview }) => {
  const { url, thumbnail, fileName, size, canPreview } = preview;
  
  return (
    <div className="image-preview">
      {canPreview ? (
        <div className="image-container">
          <img 
            src={thumbnail || url} 
            alt={fileName}
            className="preview-image"
            loading="lazy"
          />
          <div className="image-overlay">
            <span className="file-name">{fileName}</span>
            <span className="file-size">{formatFileSize(size)}</span>
          </div>
        </div>
      ) : (
        <div className="image-placeholder">
          <span className="icon">🖼️</span>
          <span className="file-name">{fileName}</span>
          <span className="file-size">{formatFileSize(size)}</span>
        </div>
      )}
    </div>
  );
};
```

### 2. Video Files
```jsx
const VideoPreview = ({ preview }) => {
  const { url, fileName, size, canPreview } = preview;
  
  return (
    <div className="video-preview">
      {canPreview ? (
        <div className="video-container">
          <video 
            src={url}
            className="preview-video"
            controls
            preload="metadata"
          />
          <div className="video-overlay">
            <span className="play-icon">▶️</span>
            <span className="file-name">{fileName}</span>
            <span className="file-size">{formatFileSize(size)}</span>
          </div>
        </div>
      ) : (
        <div className="video-placeholder">
          <span className="icon">🎥</span>
          <span className="file-name">{fileName}</span>
          <span className="file-size">{formatFileSize(size)}</span>
        </div>
      )}
    </div>
  );
};
```

### 3. Audio Files
```jsx
const AudioPreview = ({ preview }) => {
  const { url, fileName, size, canPreview } = preview;
  
  return (
    <div className="audio-preview">
      <div className="audio-container">
        <audio 
          src={url}
          controls
          className="audio-player"
        />
        <div className="audio-info">
          <span className="icon">🎵</span>
          <span className="file-name">{fileName}</span>
          <span className="file-size">{formatFileSize(size)}</span>
        </div>
      </div>
    </div>
  );
};
```

### 4. Document Files
```jsx
const DocumentPreview = ({ preview }) => {
  const { url, fileName, size, type } = preview;
  const icon = getDocumentIcon(type);
  
  return (
    <div className="document-preview">
      <div className="document-container">
        <div className="document-icon">
          <span className="icon">{icon}</span>
        </div>
        <div className="document-info">
          <span className="file-name">{fileName}</span>
          <span className="file-size">{formatFileSize(size)}</span>
          <span className="file-type">{type.toUpperCase()}</span>
        </div>
        <div className="download-button">
          <span className="icon">⬇️</span>
        </div>
      </div>
    </div>
  );
};
```

## 🎯 Display Scenarios

### Scenario 1: Message with Media Only
```jsx
// Message: "📎 Sent image.jpg"
// Has: media_url + attachment_metadata
// Display: Media preview + filename
const MediaOnlyMessage = ({ message }) => (
  <div className="message media-only">
    <MediaAttachment 
      metadata={message.attachment_metadata}
      mediaUrl={message.media_url}
    />
    <div className="message-time">{formatTime(message.created_at)}</div>
  </div>
);
```

### Scenario 2: Message with Text + Media
```jsx
// Message: "Check out this image!"
// Has: message text + media_url + attachment_metadata
// Display: Text + Media preview
const TextWithMediaMessage = ({ message }) => (
  <div className="message text-with-media">
    <div className="message-text">{message.message}</div>
    <MediaAttachment 
      metadata={message.attachment_metadata}
      mediaUrl={message.media_url}
    />
    <div className="message-time">{formatTime(message.created_at)}</div>
  </div>
);
```

### Scenario 3: Multiple Media in One Message
```jsx
// For future implementation - multiple attachments
const MultipleMediaMessage = ({ message }) => (
  <div className="message multiple-media">
    {message.attachments?.map((attachment, index) => (
      <MediaAttachment 
        key={index}
        metadata={attachment.metadata}
        mediaUrl={attachment.url}
      />
    ))}
    <div className="message-time">{formatTime(message.created_at)}</div>
  </div>
);
```

## 🔄 Real-time Updates

### Socket Event Handling
```jsx
useEffect(() => {
  const socket = io(API_BASE_URL);
  
  // Join conversation room
  socket.emit('join_conversation', conversationId);
  
  // Listen for new messages
  socket.on('new_message', (data) => {
    const { conversation_id, message, conversation_context } = data;
    
    if (conversation_id === currentConversationId) {
      // Add message to chat
      setMessages(prev => [...prev, message]);
      
      // Scroll to bottom
      scrollToBottom();
    }
  });
  
  // Listen for notifications
  socket.on('notification', (data) => {
    // Handle notification
    showNotification(data);
  });
  
  return () => {
    socket.disconnect();
  };
}, [conversationId]);
```

### Message State Management
```jsx
const [messages, setMessages] = useState([]);
const [isLoading, setIsLoading] = useState(false);

const addMessage = (newMessage) => {
  setMessages(prev => {
    // Check if message already exists
    const exists = prev.some(msg => msg.id === newMessage.id);
    if (exists) return prev;
    
    // Add new message
    return [...prev, newMessage];
  });
};

const updateMessage = (messageId, updates) => {
  setMessages(prev => 
    prev.map(msg => 
      msg.id === messageId ? { ...msg, ...updates } : msg
    )
  );
};
```

## ⚠️ Error Handling

### Media Load Error Handling
```jsx
const MediaAttachment = ({ metadata, mediaUrl, onMediaClick }) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
  };
  
  const handleLoad = () => {
    setIsLoading(false);
  };
  
  if (hasError) {
    return (
      <div className="media-error">
        <span className="icon">❌</span>
        <span className="error-text">Failed to load media</span>
        <span className="file-name">{metadata.fileName}</span>
      </div>
    );
  }
  
  return (
    <div className="media-attachment">
      {isLoading && <div className="loading-spinner">⏳</div>}
      {/* Media content with error handlers */}
    </div>
  );
};
```

### Network Error Handling
```jsx
const handleMediaClick = async (mediaData) => {
  try {
    // Check if media is accessible
    const response = await fetch(mediaData.url, { method: 'HEAD' });
    
    if (!response.ok) {
      throw new Error('Media not accessible');
    }
    
    // Open media in modal or new tab
    openMediaModal(mediaData);
    
  } catch (error) {
    showErrorToast('Failed to load media');
  }
};
```

## 🛠️ Utility Functions

### File Size Formatting
```jsx
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
```

### Document Icon Mapping
```jsx
const getDocumentIcon = (fileType) => {
  const iconMap = {
    'pdf': '📄',
    'doc': '📝',
    'docx': '📝',
    'txt': '📄',
    'xls': '📊',
    'xlsx': '📊',
    'ppt': '📊',
    'pptx': '📊',
    'zip': '📦',
    'rar': '📦'
  };
  
  return iconMap[fileType] || '📄';
};
```

### Time Formatting
```jsx
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  
  return date.toLocaleDateString();
};
```

## 🎨 CSS Styling Examples

### Message Container
```css
.message {
  display: flex;
  flex-direction: column;
  margin: 8px 0;
  padding: 12px;
  border-radius: 12px;
  max-width: 70%;
}

.message.own {
  align-self: flex-end;
  background-color: #007AFF;
  color: white;
}

.message.other {
  align-self: flex-start;
  background-color: #F2F2F7;
  color: black;
}

.media-attachment {
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}

.image-preview img {
  max-width: 200px;
  max-height: 200px;
  object-fit: cover;
  border-radius: 8px;
}

.video-preview video {
  max-width: 300px;
  max-height: 200px;
  border-radius: 8px;
}

.document-preview {
  display: flex;
  align-items: center;
  padding: 12px;
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
}

.audio-preview {
  display: flex;
  align-items: center;
  padding: 12px;
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
}
```

## 📱 Mobile Considerations

### Touch Interactions
```jsx
const MediaAttachment = ({ metadata, mediaUrl, onMediaClick }) => {
  const handleTouchStart = (e) => {
    // Prevent default to avoid scrolling
    e.preventDefault();
  };
  
  const handleTouchEnd = (e) => {
    e.preventDefault();
    onMediaClick({ url: mediaUrl, metadata });
  };
  
  return (
    <div 
      className="media-attachment"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={() => onMediaClick({ url: mediaUrl, metadata })}
    >
      {/* Media content */}
    </div>
  );
};
```

### Responsive Design
```css
@media (max-width: 768px) {
  .message {
    max-width: 85%;
  }
  
  .image-preview img {
    max-width: 150px;
    max-height: 150px;
  }
  
  .video-preview video {
    max-width: 250px;
    max-height: 150px;
  }
}
```

## 🔧 Implementation Checklist

- [ ] Create MediaAttachment component
- [ ] Implement file type specific previews
- [ ] Add error handling for media loading
- [ ] Implement real-time message updates
- [ ] Add touch interactions for mobile
- [ ] Style with responsive design
- [ ] Add loading states
- [ ] Implement media modal/fullscreen view
- [ ] Add download functionality
- [ ] Test with all file types

## 📋 File Type Support

| Type | Extensions | Preview | Icon | Max Size |
|------|------------|---------|------|----------|
| Image | .jpg, .jpeg, .png, .gif, .webp, .bmp, .svg | ✅ Thumbnail | 🖼️ | 1GB |
| Video | .mp4, .mov, .avi, .mkv, .webm, .m4v | ✅ Video Player | 🎥 | 1GB |
| Audio | .mp3, .wav, .ogg, .m4a, .aac, .flac | ✅ Audio Player | 🎵 | 200MB |
| Document | .pdf, .doc, .docx, .txt, .rtf, .odt, .xls, .xlsx, .ppt, .pptx | ❌ Icon Only | 📄 | 500MB |

This guide provides a complete implementation for displaying shared media in your chat application. The frontend should handle all these scenarios to provide a rich messaging experience.
