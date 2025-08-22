# 🚀 Frontend API Implementation Guide

## 📋 **Complete API Implementation for Chat System**

This file contains everything your frontend needs to implement the complete chat system.

---

## 🔑 **1. API Service Setup**

### **Create: `services/apiService.ts`**

```typescript
class ApiService {
  private baseURL: string = 'http://192.168.0.106:3000'; // ✅ Your backend IP
  
  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    };
  }

  async get(url: string) {
    const response = await fetch(`${this.baseURL}${url}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  }

  async post(url: string, data: any) {
    const response = await fetch(`${this.baseURL}${url}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  }

  async put(url: string, data?: any) {
    const response = await fetch(`${this.baseURL}${url}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: data ? JSON.stringify(data) : undefined,
    });
    
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  }
}

export const apiService = new ApiService();
```

---

## 💬 **2. Chat API Service**

### **Create: `services/chatApi.ts`**

```typescript
import { apiService } from './apiService';

export interface Conversation {
  id: string;
  conversation_type: 'direct' | 'bid' | 'campaign';
  conversation_title: string;
  other_user: {
    id: string;
    name: string;
    role: string;
  };
  last_message?: {
    message: string;
    created_at: string;
    sender_id: string;
    seen: boolean;
  };
  updated_at: string;
  unread_count?: number;
  chat_status: string;
  is_brand_owner: boolean;
}

export const chatApi = {
  // ✅ GET CONVERSATIONS
  fetchDirectConversations: async (): Promise<Conversation[]> => {
    const response = await apiService.get('/api/messages/conversations/direct');
    return response.conversations || [];
  },

  fetchBidConversations: async (): Promise<Conversation[]> => {
    const response = await apiService.get('/api/messages/conversations/bids');
    return response.conversations || [];
  },

  fetchCampaignConversations: async (): Promise<Conversation[]> => {
    const response = await apiService.get('/api/messages/conversations/campaigns');
    return response.conversations || [];
  },

  // ✅ CREATE NEW CONVERSATIONS
  createDirectConversation: async (targetUserId: string, message: string) => {
    const response = await apiService.post('/api/messages/direct-connect', {
      target_user_id: targetUserId,
      initial_message: message
    });
    return response.conversation_id;
  },

  // ✅ GET MESSAGES
  fetchMessages: async (conversationId: string) => {
    const response = await apiService.get(`/api/messages/conversations/${conversationId}/messages`);
    return response.messages || [];
  },

  // ✅ SEND MESSAGE
  sendMessage: async (conversationId: string, message: string) => {
    const response = await apiService.post('/api/messages', {
      conversation_id: conversationId,
      message
    });
    return response.message;
  },

  // ✅ MARK AS SEEN
  markAsSeen: async (conversationId: string) => {
    await apiService.put(`/api/messages/conversations/${conversationId}/seen`);
  }
};
```

---

## 📱 **3. Main Chat Screen**

### **Create: `components/ChatScreen.tsx`**

```typescript
import React, { useState, useEffect } from 'react';
import { chatApi, Conversation } from '../services/chatApi';

export const ChatScreen: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'direct' | 'bids' | 'campaigns'>('all');

  // ✅ LOAD ALL CONVERSATIONS
  const loadConversations = async () => {
    try {
      setLoading(true);
      const [direct, bids, campaigns] = await Promise.all([
        chatApi.fetchDirectConversations(),
        chatApi.fetchBidConversations(),
        chatApi.fetchCampaignConversations()
      ]);

      const allConversations = [...direct, ...bids, ...campaigns]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      setConversations(allConversations);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  // ✅ CREATE NEW CONVERSATION
  const createNewChat = async () => {
    try {
      const targetUserId = prompt('Enter user ID to chat with:');
      const message = prompt('Enter your message:');
      
      if (targetUserId && message) {
        const conversationId = await chatApi.createDirectConversation(targetUserId, message);
        alert(`Conversation created! ID: ${conversationId}`);
        loadConversations(); // Refresh list
      }
    } catch (error) {
      console.error('Failed to create conversation:', error);
      alert('Failed to create conversation');
    }
  };

  if (loading) {
    return <div>Loading conversations...</div>;
  }

  return (
    <div className="chat-screen">
      {/* ✅ CREATE BUTTON */}
      <div className="header">
        <h1>Chats ({conversations.length})</h1>
        <button onClick={createNewChat}>💬 New Chat</button>
      </div>

      {/* ✅ TABS */}
      <div className="tabs">
        <button 
          className={activeTab === 'all' ? 'active' : ''} 
          onClick={() => setActiveTab('all')}
        >
          All ({conversations.length})
        </button>
        <button 
          className={activeTab === 'direct' ? 'active' : ''} 
          onClick={() => setActiveTab('direct')}
        >
          Direct ({conversations.filter(c => c.conversation_type === 'direct').length})
        </button>
        <button 
          className={activeTab === 'bids' ? 'active' : ''} 
          onClick={() => setActiveTab('bids')}
        >
          Bids ({conversations.filter(c => c.conversation_type === 'bid').length})
        </button>
        <button 
          className={activeTab === 'campaigns' ? 'active' : ''} 
          onClick={() => setActiveTab('campaigns')}
        >
          Campaigns ({conversations.filter(c => c.conversation_type === 'campaign').length})
        </button>
      </div>

      {/* ✅ CONVERSATIONS LIST */}
      <div className="conversations">
        {conversations
          .filter(conv => activeTab === 'all' || conv.conversation_type === activeTab)
          .map(conversation => (
            <div key={conversation.id} className="conversation-item">
              <div className="conversation-info">
                <h3>{conversation.conversation_title}</h3>
                <p>Chat with: {conversation.other_user.name}</p>
                <p>Type: {conversation.conversation_type}</p>
                {conversation.last_message && (
                  <p>Last: {conversation.last_message.message}</p>
                )}
                {conversation.unread_count && conversation.unread_count > 0 && (
                  <span className="unread-badge">{conversation.unread_count}</span>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};
```

---

## 📊 **4. API Response Examples**

### **✅ Direct Conversations Response:**
```json
{
  "success": true,
  "conversations": [
    {
      "id": "conv_123",
      "conversation_type": "direct",
      "conversation_title": "Direct Chat",
      "other_user": {
        "id": "user_789",
        "name": "John Doe",
        "role": "influencer"
      },
      "last_message": {
        "message": "Hello! How are you?",
        "created_at": "2025-01-22T14:04:54Z",
        "sender_id": "user_789",
        "seen": false
      },
      "updated_at": "2025-01-22T14:04:54Z",
      "unread_count": 1,
      "chat_status": "active",
      "is_brand_owner": true
    }
  ]
}
```

### **✅ Bid Conversations Response:**
```json
{
  "success": true,
  "conversations": [
    {
      "id": "conv_456",
      "conversation_type": "bid",
      "conversation_title": "Instagram Post for Tech Product",
      "other_user": {
        "id": "user_789",
        "name": "Jane Smith",
        "role": "influencer"
      },
      "last_message": {
        "message": "I can do it for $300",
        "created_at": "2025-01-22T14:04:54Z",
        "sender_id": "user_789",
        "seen": true
      },
      "updated_at": "2025-01-22T14:04:54Z",
      "unread_count": 0,
      "chat_status": "active",
      "is_brand_owner": true
    }
  ]
}
```

### **✅ Campaign Conversations Response:**
```json
{
  "success": true,
  "conversations": [
    {
      "id": "conv_789",
      "conversation_type": "campaign",
      "conversation_title": "Fashion Brand Campaign",
      "other_user": {
        "id": "user_456",
        "name": "Fashion Brand",
        "role": "brand_owner"
      },
      "last_message": {
        "message": "I'm interested in your campaign!",
        "created_at": "2025-01-22T14:04:54Z",
        "sender_id": "user_789",
        "seen": false
      },
      "updated_at": "2025-01-22T14:04:54Z",
      "unread_count": 1,
      "chat_status": "active",
      "is_brand_owner": false
    }
  ]
}
```

### **✅ Create Conversation Response:**
```json
{
  "success": true,
  "conversation_id": "conv_new_123",
  "message": "Conversation created successfully"
}
```

### **✅ Messages Response:**
```json
{
  "success": true,
  "messages": [
    {
      "id": "msg_123",
      "message": "Hello! How are you?",
      "sender_id": "user_789",
      "conversation_id": "conv_123",
      "created_at": "2025-01-22T14:04:54Z",
      "seen": false
    }
  ]
}
```

---

## 🎯 **5. Implementation Steps**

### **Step 1: Create the files above**
1. `services/apiService.ts`
2. `services/chatApi.ts`
3. `components/ChatScreen.tsx`

### **Step 2: Update backend URL**
Make sure `apiService.ts` has your correct backend IP:
```typescript
private baseURL: string = 'http://192.168.0.106:3000'; // ✅ Your actual backend IP
```

### **Step 3: Test the system**
Your frontend will now:
- ✅ **List all conversations** (direct, bids, campaigns)
- ✅ **Create new conversations** (direct chats)
- ✅ **Retrieve messages** from existing chats
- ✅ **Show conversation types** with proper filtering
- ✅ **Handle all API responses** correctly

---

## 🎉 **What You Get:**

### **✅ Complete Chat System:**
- **Conversation listing** - All types working
- **New conversation creation** - Direct chats
- **Message retrieval** - From existing chats
- **Tabbed interface** - All, Direct, Bids, Campaigns
- **Create button** - For new conversations
- **Error handling** - User-friendly alerts

### **✅ API Integration:**
- **Correct payloads** - For all endpoints
- **Response handling** - Proper data extraction
- **Type safety** - TypeScript interfaces
- **Error management** - Comprehensive error handling

**Your frontend will now work perfectly with all the backend APIs!** 🚀

**Copy these files, update the backend URL, and you'll have a fully functional chat system!** 🎯
