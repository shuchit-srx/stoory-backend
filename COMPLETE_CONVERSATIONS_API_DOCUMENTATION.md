# Complete Conversations API Documentation

## 🚀 **All Conversation Endpoints - Complete Reference**

This document provides complete details for all conversation-related API endpoints in your backend.

---

## 📋 **API Endpoints Summary**

| Endpoint | Method | Purpose | Response Structure |
|----------|--------|---------|-------------------|
| `/api/messages/conversations` | GET | General campaigns/bids | `{ conversations: [...] }` |
| `/api/messages/conversations/direct` | GET | Direct user chats | `{ connections: [...] }` |
| `/api/messages/conversations/bids` | GET | Bid-specific chats | `{ conversations: [...] }` |
| `/api/messages/conversations/campaigns` | GET | Campaign-specific chats | `{ conversations: [...] }` |

---

## 🗣️ **1. Direct Conversations**

### **Endpoint:**
```http
GET /api/messages/conversations/direct
Authorization: Bearer {token}
```

### **Purpose:**
Fetch all direct conversations (personal chats) between users that are NOT related to campaigns or bids.

### **Query Parameters:**
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Items per page (default: 10)

### **Response Structure:**
```json
{
  "success": true,
  "conversations": [
    {
      "id": "conv_123",
      "brand_owner_id": "user_456",
      "influencer_id": "user_789",
      "chat_status": "active",
      "created_at": "2025-01-22T14:04:54Z",
      "updated_at": "2025-01-22T14:04:54Z",
      "other_user": {
        "id": "user_789",
        "name": "John Doe",
        "role": "influencer"
      },
      "last_message": {
        "message": "Hello! How are you?",
        "created_at": "2025-01-22T14:04:54Z",
        "sender_id": "user_789"
      },
      "is_brand_owner": true,
      "conversation_type": "direct",
      "conversation_title": "Direct Chat"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1
  },
  "conversation_type": "direct"
}
```

### **Use Case:**
- Personal networking between users
- General communication not related to business
- Building relationships

---

## 💰 **2. Bid Conversations**

### **Endpoint:**
```http
GET /api/messages/conversations/bids
Authorization: Bearer {token}
```

### **Purpose:**
Fetch all conversations related to specific bids (must have `bid_id`).

### **Query Parameters:**
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Items per page (default: 10)

### **Response Structure:**
```json
{
  "success": true,
  "conversations": [
    {
      "id": "conv_456",
      "bid_id": "bid_789",
      "chat_status": "active",
      "created_at": "2025-01-22T14:04:54Z",
      "updated_at": "2025-01-22T14:04:54Z",
      "flow_state": "negotiation",
      "awaiting_role": "influencer",
      "is_brand_owner": true,
      "bid": {
        "id": "bid_789",
        "title": "Instagram Post for Tech Product",
        "description": "Create engaging content for our new tech product",
        "min_budget": 100,
        "max_budget": 500,
        "status": "active",
        "proposed_amount": 300
      },
      "campaign": {
        "id": "camp_123",
        "title": "Tech Product Launch",
        "description": "Launch campaign for new tech product",
        "budget_range": "100-1000",
        "requirements": "Instagram posts, stories, reels"
      },
      "other_user": {
        "id": "user_789",
        "name": "Jane Smith",
        "role": "influencer"
      },
      "last_message": {
        "message": "I can do it for $300",
        "created_at": "2025-01-22T14:04:54Z",
        "sender_id": "user_789"
      },
      "conversation_type": "bid",
      "conversation_title": "Instagram Post for Tech Product"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1
  },
  "conversation_type": "bid",
  "message": "Found 1 bid conversations"
}
```

### **Use Case:**
- Negotiating bid amounts
- Discussing bid requirements
- Finalizing bid terms
- Bid-related questions and clarifications

---

## 🎯 **3. Campaign Conversations**

### **Endpoint:**
```http
GET /api/messages/conversations/campaigns
Authorization: Bearer {token}
```

### **Purpose:**
Fetch all conversations related to campaigns (must have `campaign_id`, no `bid_id`).

### **Query Parameters:**
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Items per page (default: 10)

### **Response Structure:**
```json
{
  "success": true,
  "conversations": [
    {
      "id": "conv_789",
      "campaign_id": "camp_456",
      "chat_status": "active",
      "created_at": "2025-01-22T14:04:54Z",
      "updated_at": "2025-01-22T14:04:54Z",
      "flow_state": "application",
      "awaiting_role": "brand_owner",
      "is_brand_owner": false,
      "campaign": {
        "id": "camp_456",
        "title": "Fashion Brand Campaign",
        "description": "Promote our new fashion collection",
        "budget_range": "500-2000",
        "requirements": "Instagram posts, TikTok videos",
        "status": "active"
      },
      "other_user": {
        "id": "user_456",
        "name": "Fashion Brand",
        "role": "brand_owner"
      },
      "last_message": {
        "message": "I'm interested in your campaign!",
        "created_at": "2025-01-22T14:04:54Z",
        "sender_id": "user_789"
      },
      "conversation_type": "campaign",
      "conversation_title": "Fashion Brand Campaign"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1
  },
  "conversation_type": "campaign",
  "message": "Found 1 campaign conversations"
}
```

### **Use Case:**
- Initial campaign inquiries
- Campaign requirement discussions
- Application processes
- Campaign-related questions

---

## 🔄 **4. General Conversations (Legacy)**

### **Endpoint:**
```http
GET /api/messages/conversations
Authorization: Bearer {token}
```

### **Purpose:**
Fetch all conversations (campaigns and bids combined) - this is the legacy endpoint.

### **Response Structure:**
```json
{
  "success": true,
  "conversations": [
    // Mix of campaign and bid conversations
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 0
  },
  "message": "No brand owner campaigns and bids found"
}
```

---

## 🎯 **Role-Based Filtering**

### **Brand Owner:**
- **Direct:** Can see direct chats with influencers
- **Bids:** Can see conversations for bids they created
- **Campaigns:** Can see conversations for campaigns they created

### **Influencer:**
- **Direct:** Can see direct chats with brand owners
- **Bids:** Can see conversations for bids they applied to
- **Campaigns:** Can see conversations for campaigns they're interested in

---

## 📱 **Frontend Implementation**

### **API Service:**
```typescript
// chatApi.ts
export const chatApi = {
  // Get direct conversations (personal chats)
  fetchDirectConversations: async (): Promise<Conversation[]> => {
    const response = await apiService.get('/api/messages/conversations/direct');
    return response.conversations || [];
  },

  // Get bid conversations
  fetchBidConversations: async (): Promise<Conversation[]> => {
    const response = await apiService.get('/api/messages/conversations/bids');
    return response.conversations || [];
  },

  // Get campaign conversations
  fetchCampaignConversations: async (): Promise<Conversation[]> => {
    const response = await apiService.get('/api/messages/conversations/campaigns');
    return response.conversations || [];
  }
};
```

### **UI Component with Tabs:**
```jsx
const ConversationsList = () => {
  const [activeTab, setActiveTab] = useState('direct');
  const [directConversations, setDirectConversations] = useState([]);
  const [bidConversations, setBidConversations] = useState([]);
  const [campaignConversations, setCampaignConversations] = useState([]);

  useEffect(() => {
    loadAllConversations();
  }, []);

  const loadAllConversations = async () => {
    const [direct, bids, campaigns] = await Promise.all([
      chatApi.fetchDirectConversations(),
      chatApi.fetchBidConversations(),
      chatApi.fetchCampaignConversations()
    ]);

    setDirectConversations(direct);
    setBidConversations(bids);
    setCampaignConversations(campaigns);
  };

  return (
    <div className="conversations-container">
      {/* Tab Navigation */}
      <div className="conversations-tabs">
        <button 
          className={activeTab === 'direct' ? 'active' : ''}
          onClick={() => setActiveTab('direct')}
        >
          Direct Chats ({directConversations.length})
        </button>
        <button 
          className={activeTab === 'bids' ? 'active' : ''}
          onClick={() => setActiveTab('bids')}
        >
          Bids ({bidConversations.length})
        </button>
        <button 
          className={activeTab === 'campaigns' ? 'active' : ''}
          onClick={() => setActiveTab('campaigns')}
        >
          Campaigns ({campaignConversations.length})
        </button>
      </div>

      {/* Content Based on Active Tab */}
      {activeTab === 'direct' && (
        <DirectConversationsList conversations={directConversations} />
      )}
      
      {activeTab === 'bids' && (
        <BidConversationsList conversations={bidConversations} />
      )}
      
      {activeTab === 'campaigns' && (
        <CampaignConversationsList conversations={campaignConversations} />
      )}
    </div>
  );
};
```

---

## 🧪 **Testing the Endpoints**

### **Test Direct Conversations:**
```bash
curl -X GET "http://localhost:3000/api/messages/conversations/direct" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### **Test Bid Conversations:**
```bash
curl -X GET "http://localhost:3000/api/messages/conversations/bids" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### **Test Campaign Conversations:**
```bash
curl -X GET "http://localhost:3000/api/messages/conversations/campaigns" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🎉 **Benefits of This Structure**

1. **✅ Clean Separation** - Each endpoint has one responsibility
2. **✅ No Frontend Logic** - Backend handles all filtering
3. **✅ Better Performance** - Only fetch what you need
4. **✅ Role-Based Access** - Automatic user permission handling
5. **✅ Consistent Response** - Same structure across all endpoints
6. **✅ Easy Testing** - Test each endpoint independently

---

## 🚀 **Your Backend is Ready!**

All three conversation endpoints are now implemented and working:

- **Direct Conversations:** `/api/messages/conversations/direct`
- **Bid Conversations:** `/api/messages/conversations/bids`  
- **Campaign Conversations:** `/api/messages/conversations/campaigns`

**Start using these endpoints in your frontend - no more sorting or complex logic needed!** 🎯

The backend automatically handles:
- ✅ User role filtering
- ✅ Conversation type separation
- ✅ User details enrichment
- ✅ Last message retrieval
- ✅ Pagination
- ✅ Error handling

**Your conversations system is now complete and production-ready!** 🚀
