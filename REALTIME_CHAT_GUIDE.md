# 🚀 Real-Time Chat System Implementation Guide

## 📋 Table of Contents
1. [Overview](#overview)
2. [Backend Implementation](#backend-implementation)
3. [Frontend Integration](#frontend-integration)
4. [Socket Events Reference](#socket-events-reference)
5. [API Endpoints](#api-endpoints)
6. [Database Schema](#database-schema)
7. [Testing Guide](#testing-guide)
8. [Troubleshooting](#troubleshooting)
9. [Performance Considerations](#performance-considerations)

## 🎯 Overview

This guide covers the complete real-time chat system implementation that enables:
- **Real-time chat list updates** without page refresh
- **Live typing indicators** in chat list
- **Online/offline status** tracking
- **Unread count management** with live updates
- **Push notifications** (FCM + Socket)
- **Automated flow notifications** for initialization and state changes
- **Conversation state awareness** across the app
- **Profile image display** in chat list with fallback handling

## 🔧 Backend Implementation

### FCM Notifications for Automated Messages

The system now includes comprehensive FCM notifications for all automated flow messages:

#### **Initialization Notifications:**
- **Bid Conversations** - Notifies influencer when a new bid connection is made
- **Campaign Conversations** - Notifies influencer when a new campaign connection is made
- **Custom Messages** - Uses specific messages like "You have a new connection request"

#### **Flow State Notifications:**
- **Brand Owner Actions** - Notifies influencer when brand owner takes actions
- **Influencer Actions** - Notifies brand owner when influencer responds
- **Work Review Actions** - Notifies appropriate user when work is reviewed
- **State Changes** - Notifies users when conversation state changes

#### **Implementation Details:**
```javascript
// Example: Bid conversation initialization
fcmService.sendFlowStateNotification(
  conversation.id, 
  influencerId, 
  "influencer_responding",
  "You have a new connection request"
);

// Example: Work review notification
fcmService.sendFlowStateNotification(
  conversationId, 
  targetUserId, 
  newFlowState,
  messageText
);
```

### Profile Image URL Support

The conversation listing now includes profile image URLs for all users:

#### **Database Schema:**
```sql
-- Users table includes profile_image_url field
CREATE TABLE users (
    id UUID PRIMARY KEY,
    name TEXT,
    role user_role,
    profile_image_url TEXT,  -- URL of user's profile image
    -- ... other fields
);
```

#### **API Response Structure:**
```javascript
{
  "conversations": [
    {
      "id": "conversation-uuid",
      "other_user": {
        "id": "user-uuid",
        "name": "John Doe",
        "role": "influencer",
        "profile_image_url": "https://storage.supabase.co/avatars/user123.jpg"
      },
      "last_message": { /* ... */ },
      "conversation_type": "direct",
      // ... other fields
    }
  ]
}
```

#### **Fallback Handling:**
- **Null Profile URL** - Returns `null` if user hasn't set a profile image
- **Error Handling** - Returns `null` if user data can't be fetched
- **Frontend Fallback** - Frontend should handle `null` values with default avatar

### Socket.IO Setup

The system uses Socket.IO for real-time communication with the following configuration:

```javascript
// index.js
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN?.split(",") || [
      "http://localhost:3000",
      "http://localhost:3001", 
      "http://localhost:5173",
      "http://localhost:8081"
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});
```

### Socket Rooms

The system uses multiple socket rooms for different types of updates:

```javascript
// User-specific rooms
`user_${userId}`           // Individual user updates
`global_${userId}`         // Global updates for user
`notifications_${userId}`  // Notification updates

// Conversation rooms
`conversation_${conversationId}`  // Conversation-specific updates

// Campaign/Bid rooms
`bid_${bidId}`             // Bid-specific updates
`campaign_${campaignId}`   // Campaign-specific updates
```

### Key Socket Events

#### Client → Server Events

```javascript
// Connection and room management
socket.emit('join', userId);                           // Join user room
socket.emit('join_conversation', conversationId);      // Join conversation
socket.emit('join_global_updates', userId);           // Join global updates
socket.emit('request_global_notifications', userId);   // Request notifications

// Messaging
socket.emit('send_message', {
  conversationId,
  senderId,
  receiverId,
  message,
  mediaUrl
});

// Typing indicators
socket.emit('typing_start', { conversationId, userId });
socket.emit('typing_stop', { conversationId, userId });

// Message status
socket.emit('mark_seen', { messageId, userId, conversationId });

// User status
socket.emit('user_status', { userId, status: 'online' });
```

#### Server → Client Events

```javascript
// Conversation list updates
socket.on('conversation_list_updated', (data) => {
  // data: { conversation_id, action, message, timestamp, ... }
});

// Unread count updates
socket.on('unread_count_updated', (data) => {
  // data: { conversation_id, unread_count, action, timestamp }
});

// Typing indicators
socket.on('typing_status_update', (data) => {
  // data: { conversation_id, user_id, is_typing, timestamp }
});

// User status updates
socket.on('user_status_update', (data) => {
  // data: { user_id, status, timestamp }
});

// New messages
socket.on('new_message', (data) => {
  // data: { conversation_id, message, conversation_context }
});

// Conversation state changes
socket.on('conversation_state_changed', (data) => {
  // data: { conversation_id, flow_state, awaiting_role, chat_status }
});

// Message seen events
socket.on('message_seen', (data) => {
  // data: { messageId, userId, conversationId, timestamp }
});

socket.on('messages_seen', (data) => {
  // data: { conversationId, userId, timestamp }
});

socket.on('message_seen_update', (data) => {
  // data: { messageId, conversationId, timestamp }
});

socket.on('messages_seen_update', (data) => {
  // data: { conversationId, timestamp }
});
```

## 🎨 Frontend Integration

### React Implementation Example

#### 1. Socket Connection Setup

```javascript
// hooks/useSocket.js
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

export const useSocket = (userId) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const newSocket = io(process.env.REACT_APP_SOCKET_URL, {
      auth: { userId },
      transports: ['websocket']
    });

    newSocket.on('connect', () => {
      console.log('Connected to socket server');
      setIsConnected(true);
      
      // Join necessary rooms
      newSocket.emit('join', userId);
      newSocket.emit('join_global_updates', userId);
      newSocket.emit('request_global_notifications', userId);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from socket server');
      setIsConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [userId]);

  return { socket, isConnected };
};
```

#### 2. Chat List Component

```javascript
// components/ChatList.jsx
import React, { useState, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';

const ChatList = ({ userId, conversations, onConversationSelect }) => {
  const { socket } = useSocket(userId);
  const [liveConversations, setLiveConversations] = useState(conversations);
  const [typingUsers, setTypingUsers] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [unreadCounts, setUnreadCounts] = useState({});

  useEffect(() => {
    if (!socket) return;

    // Listen for conversation list updates
    const handleConversationUpdate = (data) => {
      setLiveConversations(prev => {
        const updated = [...prev];
        const index = updated.findIndex(conv => conv.id === data.conversation_id);
        
        if (index !== -1) {
          updated[index] = {
            ...updated[index],
            last_message: data.message,
            updated_at: data.timestamp,
            flow_state: data.flow_state,
            awaiting_role: data.awaiting_role
          };
        }
        
        return updated.sort((a, b) => 
          new Date(b.updated_at) - new Date(a.updated_at)
        );
      });
    };

    // Listen for unread count updates
    const handleUnreadUpdate = (data) => {
      setUnreadCounts(prev => ({
        ...prev,
        [data.conversation_id]: data.unread_count
      }));
    };

    // Listen for typing indicators
    const handleTypingUpdate = (data) => {
      setTypingUsers(prev => ({
        ...prev,
        [data.conversation_id]: data.is_typing ? data.user_id : null
      }));
    };

    // Listen for online status updates
    const handleUserStatusUpdate = (data) => {
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        if (data.status === 'online') {
          newSet.add(data.user_id);
        } else {
          newSet.delete(data.user_id);
        }
        return newSet;
      });
    };

    // Listen for message seen events
    const handleMessageSeen = (data) => {
      // Update message seen status in conversation
      setConversations(prev => {
        return prev.map(conv => {
          if (conv.id === data.conversationId) {
            return {
              ...conv,
              last_message: conv.last_message ? {
                ...conv.last_message,
                seen: true
              } : conv.last_message
            };
          }
          return conv;
        });
      });
    };

    const handleMessagesSeen = (data) => {
      // Update all messages in conversation as seen
      setConversations(prev => {
        return prev.map(conv => {
          if (conv.id === data.conversationId) {
            return {
              ...conv,
              last_message: conv.last_message ? {
                ...conv.last_message,
                seen: true
              } : conv.last_message
            };
          }
          return conv;
        });
      });
    };

    // Register event listeners
    socket.on('conversation_list_updated', handleConversationUpdate);
    socket.on('unread_count_updated', handleUnreadUpdate);
    socket.on('typing_status_update', handleTypingUpdate);
    socket.on('user_status_update', handleUserStatusUpdate);
    socket.on('message_seen', handleMessageSeen);
    socket.on('messages_seen', handleMessagesSeen);

    return () => {
      socket.off('conversation_list_updated', handleConversationUpdate);
      socket.off('unread_count_updated', handleUnreadUpdate);
      socket.off('typing_status_update', handleTypingUpdate);
      socket.off('user_status_update', handleUserStatusUpdate);
      socket.off('message_seen', handleMessageSeen);
      socket.off('messages_seen', handleMessagesSeen);
    };
  }, [socket]);

  return (
    <div className="chat-list">
      {liveConversations.map(conversation => (
        <ChatItem
          key={conversation.id}
          conversation={conversation}
          isTyping={typingUsers[conversation.id]}
          isOnline={onlineUsers.has(conversation.other_user_id)}
          unreadCount={unreadCounts[conversation.id] || 0}
          onClick={() => onConversationSelect(conversation)}
        />
      ))}
    </div>
  );
};

export default ChatList;
```

#### 3. Chat Item Component

```javascript
// components/ChatItem.jsx
import React from 'react';

const ChatItem = ({ 
  conversation, 
  isTyping, 
  isOnline, 
  unreadCount, 
  onClick 
}) => {
  const formatLastMessage = (message) => {
    if (!message) return 'No messages yet';
    
    if (message.type === 'image') return '📷 Image';
    if (message.type === 'file') return '📎 File';
    if (message.type === 'system') return message.content;
    
    return message.content;
  };

  const getStatusIndicator = () => {
    if (isTyping) return '✍️ Typing...';
    if (isOnline) return '🟢 Online';
    return '⚪ Offline';
  };

  return (
    <div 
      className={`chat-item ${unreadCount > 0 ? 'unread' : ''}`}
      onClick={onClick}
    >
      <div className="chat-avatar">
        <img 
          src={conversation.other_user.profile_image_url || '/default-avatar.png'} 
          alt="Avatar" 
          onError={(e) => {
            e.target.src = '/default-avatar.png';
          }}
        />
        <div className={`status-indicator ${isOnline ? 'online' : 'offline'}`} />
      </div>
      
      <div className="chat-content">
        <div className="chat-header">
          <h3>{conversation.other_user.name}</h3>
          <span className="timestamp">
            {new Date(conversation.updated_at).toLocaleTimeString()}
          </span>
        </div>
        
        <div className="chat-preview">
          <p className="last-message">
            {isTyping ? '✍️ Typing...' : formatLastMessage(conversation.last_message)}
          </p>
          {unreadCount > 0 && (
            <span className="unread-badge">{unreadCount}</span>
          )}
        </div>
        
        <div className="chat-status">
          <span className="flow-state">
            {conversation.flow_state?.replace('_', ' ')}
          </span>
          <span className="user-status">{getStatusIndicator()}</span>
        </div>
      </div>
    </div>
  );
};

export default ChatItem;
```

#### 4. Chat Window Component

```javascript
// components/ChatWindow.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../hooks/useSocket';

const ChatWindow = ({ conversation, currentUserId }) => {
  const { socket } = useSocket(currentUserId);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
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

    // Listen for typing indicators
    const handleTyping = (data) => {
      if (data.conversationId === conversation.id) {
        setTypingUsers(prev => {
          const newSet = new Set(prev);
          if (data.isTyping) {
            newSet.add(data.userId);
          } else {
            newSet.delete(data.userId);
          }
          return newSet;
        });
      }
    };

    socket.on('new_message', handleNewMessage);
    socket.on('user_typing', handleTyping);

    return () => {
      socket.emit('leave_conversation', conversation.id);
      socket.off('new_message', handleNewMessage);
      socket.off('user_typing', handleTyping);
    };
  }, [socket, conversation]);

  const sendMessage = () => {
    if (!newMessage.trim() || !socket) return;

    socket.emit('send_message', {
      conversationId: conversation.id,
      senderId: currentUserId,
      receiverId: conversation.other_user_id,
      message: newMessage.trim()
    });

    setNewMessage('');
  };

  const handleTypingStart = () => {
    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing_start', {
        conversationId: conversation.id,
        userId: currentUserId
      });
    }
  };

  const handleTypingStop = () => {
    if (isTyping) {
      setIsTyping(false);
      socket.emit('typing_stop', {
        conversationId: conversation.id,
        userId: currentUserId
      });
    }
  };

  return (
    <div className="chat-window">
      <div className="chat-header">
        <h2>{conversation.other_user.name}</h2>
        <div className="typing-indicator">
          {typingUsers.size > 0 && (
            <span>{Array.from(typingUsers).join(', ')} is typing...</span>
          )}
        </div>
      </div>

      <div className="messages-container" ref={messagesEndRef}>
        {messages.map(message => (
          <MessageBubble
            key={message.id}
            message={message}
            isOwn={message.sender_id === currentUserId}
          />
        ))}
      </div>

      <div className="message-input">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') sendMessage();
          }}
          onFocus={handleTypingStart}
          onBlur={handleTypingStop}
          placeholder="Type a message..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
};

export default ChatWindow;
```

## 📡 Socket Events Reference

### Complete Event List

| Event | Direction | Purpose | Data Structure |
|-------|-----------|---------|----------------|
| `join` | Client → Server | Join user room | `{ userId }` |
| `join_conversation` | Client → Server | Join conversation | `{ conversationId }` |
| `join_global_updates` | Client → Server | Join global updates | `{ userId }` |
| `request_global_notifications` | Client → Server | Request notifications | `{ userId }` |
| `send_message` | Client → Server | Send message | `{ conversationId, senderId, receiverId, message, mediaUrl? }` |
| `typing_start` | Client → Server | Start typing | `{ conversationId, userId }` |
| `typing_stop` | Client → Server | Stop typing | `{ conversationId, userId }` |
| `mark_seen` | Client → Server | Mark message as seen | `{ messageId, userId, conversationId }` |
| `user_status` | Client → Server | Update user status | `{ userId, status }` |
| `conversation_list_updated` | Server → Client | Update chat list | `{ conversation_id, action, message?, timestamp, ... }` |
| `unread_count_updated` | Server → Client | Update unread count | `{ conversation_id, unread_count, action, timestamp }` |
| `typing_status_update` | Server → Client | Typing indicator | `{ conversation_id, user_id, is_typing, timestamp }` |
| `user_status_update` | Server → Client | User status change | `{ user_id, status, timestamp }` |
| `new_message` | Server → Client | New message received | `{ conversation_id, message, conversation_context }` |
| `conversation_state_changed` | Server → Client | State change | `{ conversation_id, flow_state, awaiting_role, chat_status }` |
| `message_seen` | Server → Client | Single message seen | `{ messageId, userId, conversationId, timestamp }` |
| `messages_seen` | Server → Client | Multiple messages seen | `{ conversationId, userId, timestamp }` |
| `message_seen_update` | Server → Client | Message seen update | `{ messageId, conversationId, timestamp }` |
| `messages_seen_update` | Server → Client | Messages seen update | `{ conversationId, timestamp }` |

## 🔌 API Endpoints

### Message Endpoints

```javascript
// Send message via REST API
POST /api/messages/send
{
  "conversation_id": "uuid",
  "message": "Hello world",
  "media_url": "optional"
}

// Get conversations
GET /api/conversations?user_id=uuid&role=influencer|brand_owner

// Get conversation messages
GET /api/conversations/:id/messages?page=1&limit=50

// Mark messages as seen
POST /api/messages/mark-seen
{
  "message_id": "uuid",
  "user_id": "uuid"
}
```

### Socket Test Endpoints

```javascript
// Test socket connection
GET /test-socket

// Test message sending
POST /test-message
{
  "conversationId": "uuid",
  "senderId": "uuid", 
  "receiverId": "uuid",
  "message": "Test message"
}
```

## 🗄️ Database Schema

### Key Tables

```sql
-- Conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  brand_owner_id UUID REFERENCES users(id),
  influencer_id UUID REFERENCES users(id),
  flow_state VARCHAR(50),
  awaiting_role VARCHAR(20),
  chat_status VARCHAR(20) DEFAULT 'automated',
  last_message_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Messages table  
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id),
  sender_id UUID REFERENCES users(id),
  content TEXT,
  message_type VARCHAR(20) DEFAULT 'text',
  media_url TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- FCM tokens table
CREATE TABLE fcm_tokens (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  token TEXT UNIQUE,
  platform VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMP DEFAULT NOW()
);
```

## 🧪 Testing Guide

### 1. Socket Connection Test

```javascript
// Test socket connection
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('✅ Connected to socket server');
  
  // Test joining rooms
  socket.emit('join', 'test-user-id');
  socket.emit('join_global_updates', 'test-user-id');
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from socket server');
});
```

### 2. Message Flow Test

```javascript
// Test message sending
socket.emit('send_message', {
  conversationId: 'test-conversation-id',
  senderId: 'sender-id',
  receiverId: 'receiver-id',
  message: 'Test message'
});

// Listen for response
socket.on('conversation_list_updated', (data) => {
  console.log('✅ Chat list updated:', data);
});
```

### 3. Typing Indicator Test

```javascript
// Test typing indicators
socket.emit('typing_start', {
  conversationId: 'test-conversation-id',
  userId: 'test-user-id'
});

// Listen for typing updates
socket.on('typing_status_update', (data) => {
  console.log('✅ Typing status:', data);
});
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Socket Connection Fails
```javascript
// Check CORS configuration
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true
  }
});

// Check authentication
socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
```

#### 2. Messages Not Updating
```javascript
// Ensure proper room joining
socket.emit('join_global_updates', userId);
socket.emit('join_conversation', conversationId);

// Check event listeners
socket.on('conversation_list_updated', (data) => {
  console.log('Received update:', data);
});
```

#### 3. Typing Indicators Not Working
```javascript
// Ensure proper event emission
socket.emit('typing_start', { conversationId, userId });
socket.emit('typing_stop', { conversationId, userId });

// Check room membership
socket.emit('join_conversation', conversationId);
```

### Debug Mode

Enable debug logging:

```javascript
// Backend
const io = socketIo(server, {
  cors: { /* ... */ },
  transports: ['websocket']
});

// Frontend
const socket = io(url, {
  transports: ['websocket'],
  debug: true
});
```

## ⚡ Performance Considerations

### 1. Connection Management
- Limit concurrent connections per user
- Implement connection pooling
- Use Redis for scaling across multiple servers

### 2. Message Optimization
- Implement message pagination
- Use message compression
- Cache frequently accessed data

### 3. Real-time Updates
- Debounce typing indicators
- Batch multiple updates
- Use selective room joining

### 4. Memory Management
- Clean up unused socket rooms
- Implement message archiving
- Monitor memory usage

## 🚀 Deployment

### Environment Variables

```bash
# Socket.IO configuration
SOCKET_PORT=3000
CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# FCM configuration
FCM_SERVER_KEY=your-fcm-server-key
FCM_PROJECT_ID=your-project-id

# Database
DATABASE_URL=your-database-url
```

### Production Checklist

- [ ] Enable CORS for production domains
- [ ] Configure FCM for production
- [ ] Set up Redis for scaling
- [ ] Implement rate limiting
- [ ] Add authentication middleware
- [ ] Monitor socket connections
- [ ] Set up error logging

## 📚 Additional Resources

- [Socket.IO Documentation](https://socket.io/docs/)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [React Hooks Guide](https://reactjs.org/docs/hooks-intro.html)
- [WebSocket Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

---

**🎉 Your real-time chat system is now ready! The chat list will update in real-time with all the features you requested.**
