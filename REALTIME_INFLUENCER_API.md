# 🚀 Real-Time Influencer Lists API Documentation

## 📋 Overview

This API provides real-time influencer lists for bids and campaigns. When an influencer sends a bid request, their details are immediately displayed in the corresponding bid/campaign overview screens.

## 🔧 API Endpoints

### **1. Get Influencers for a Bid**

#### **Endpoint:** `GET /api/requests/bid/:bid_id/influencers`

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**URL Parameters:**
- `bid_id`: Bid UUID

**Success Response (200):**
```json
{
  "success": true,
  "influencers": [
    {
      "id": "request-uuid",
      "status": "pending",
      "final_agreed_amount": null,
      "initial_payment": null,
      "final_payment": null,
      "created_at": "2025-08-12T10:30:00Z",
      "influencer": {
        "id": "influencer-uuid",
        "phone": "+1234567890",
        "email": "influencer@example.com",
        "name": "John Doe",
        "languages": ["English", "Spanish"],
        "categories": ["fashion", "lifestyle"],
        "min_range": 1000,
        "max_range": 5000,
        "role": "influencer"
      }
    }
  ],
  "total": 1
}
```

**Error Response (403/404/500):**
```json
{
  "success": false,
  "message": "Error message"
}
```

---

### **2. Get Influencers for a Campaign**

#### **Endpoint:** `GET /api/requests/campaign/:campaign_id/influencers`

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**URL Parameters:**
- `campaign_id`: Campaign UUID

**Success Response (200):**
```json
{
  "success": true,
  "influencers": [
    {
      "id": "request-uuid",
      "status": "pending",
      "final_agreed_amount": null,
      "initial_payment": null,
      "final_payment": null,
      "created_at": "2025-08-12T10:30:00Z",
      "influencer": {
        "id": "influencer-uuid",
        "phone": "+1234567890",
        "email": "influencer@example.com",
        "name": "Jane Smith",
        "bio": "Tech and lifestyle content creator",
        "profile_image": "https://example.com/profile.jpg",
        "followers_count": 75000,
        "engagement_rate": 4.2,
        "categories": ["tech", "lifestyle"],
        "languages": ["English"],
        "platforms": ["YouTube", "Instagram"]
      }
    }
  ],
  "total": 1
}
```

---

### **3. Get Real-Time Influencer Count for a Bid**

#### **Endpoint:** `GET /api/requests/bid/:bid_id/influencer-count`

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 5
}
```

---

### **4. Get Real-Time Influencer Count for a Campaign**

#### **Endpoint:** `GET /api/requests/campaign/:campaign_id/influencer-count`

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 8
}
```

---

## 🔌 Socket.IO Real-Time Events

### **Client-Side Socket Events**

#### **Join Bid Room:**
```javascript
socket.emit('join_bid_room', bidId);
```

#### **Join Campaign Room:**
```javascript
socket.emit('join_campaign_room', campaignId);
```

#### **Leave Bid Room:**
```javascript
socket.emit('leave_bid_room', bidId);
```

#### **Leave Campaign Room:**
```javascript
socket.emit('leave_campaign_room', campaignId);
```

### **Server-Side Socket Events**

#### **New Influencer Application:**
```javascript
// Emitted when an influencer applies to a bid/campaign
socket.on('new_influencer_application', (data) => {
  console.log('New application:', data);
  // data structure:
  // {
  //   type: 'bid' | 'campaign',
  //   bidId: 'uuid' (if type is 'bid'),
  //   campaignId: 'uuid' (if type is 'campaign'),
  //   influencerId: 'uuid',
  //   requestId: 'uuid',
  //   timestamp: '2025-08-12T10:30:00Z'
  // }
});
```

---

## 🎯 Frontend Implementation Examples

### **React/JavaScript Implementation**

#### **Bid Overview Screen:**
```javascript
// BidOverviewScreen.js
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

const BidOverviewScreen = ({ bidId }) => {
  const [influencers, setInfluencers] = useState([]);
  const [influencerCount, setInfluencerCount] = useState(0);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    // Join bid room for real-time updates
    newSocket.emit('join_bid_room', bidId);

    // Listen for new influencer applications
    newSocket.on('new_influencer_application', (data) => {
      if (data.type === 'bid' && data.bidId === bidId) {
        // Refresh influencer list
        fetchInfluencers();
        fetchInfluencerCount();
      }
    });

    // Initial data fetch
    fetchInfluencers();
    fetchInfluencerCount();

    return () => {
      newSocket.emit('leave_bid_room', bidId);
      newSocket.disconnect();
    };
  }, [bidId]);

  const fetchInfluencers = async () => {
    try {
      const response = await fetch(`/api/requests/bid/${bidId}/influencers`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });
      const result = await response.json();
      
      if (result.success) {
        setInfluencers(result.influencers);
      }
    } catch (error) {
      console.error('Error fetching influencers:', error);
    }
  };

  const fetchInfluencerCount = async () => {
    try {
      const response = await fetch(`/api/requests/bid/${bidId}/influencer-count`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });
      const result = await response.json();
      
      if (result.success) {
        setInfluencerCount(result.count);
      }
    } catch (error) {
      console.error('Error fetching influencer count:', error);
    }
  };

  return (
    <div>
      <h2>Bid Overview</h2>
      <div className="influencer-count">
        <span>Total Applications: {influencerCount}</span>
      </div>
      
      <div className="influencers-list">
        {influencers.map((item) => (
          <div key={item.id} className="influencer-card">
            <img src={item.influencer.profile_image} alt="Profile" />
            <div className="influencer-info">
              <h3>{item.influencer.name}</h3>
              <p>{item.influencer.bio}</p>
              <div className="stats">
                <span>Followers: {item.influencer.followers_count.toLocaleString()}</span>
                <span>Engagement: {item.influencer.engagement_rate}%</span>
              </div>
              <div className="categories">
                {item.influencer.categories.map(cat => (
                  <span key={cat} className="tag">{cat}</span>
                ))}
              </div>
              <div className="status">
                Status: <span className={`status-${item.status}`}>{item.status}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

#### **Campaign Overview Screen:**
```javascript
// CampaignOverviewScreen.js
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

const CampaignOverviewScreen = ({ campaignId }) => {
  const [influencers, setInfluencers] = useState([]);
  const [influencerCount, setInfluencerCount] = useState(0);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    // Join campaign room for real-time updates
    newSocket.emit('join_campaign_room', campaignId);

    // Listen for new influencer applications
    newSocket.on('new_influencer_application', (data) => {
      if (data.type === 'campaign' && data.campaignId === campaignId) {
        // Refresh influencer list
        fetchInfluencers();
        fetchInfluencerCount();
      }
    });

    // Initial data fetch
    fetchInfluencers();
    fetchInfluencerCount();

    return () => {
      newSocket.emit('leave_campaign_room', campaignId);
      newSocket.disconnect();
    };
  }, [campaignId]);

  const fetchInfluencers = async () => {
    try {
      const response = await fetch(`/api/requests/campaign/${campaignId}/influencers`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });
      const result = await response.json();
      
      if (result.success) {
        setInfluencers(result.influencers);
      }
    } catch (error) {
      console.error('Error fetching influencers:', error);
    }
  };

  const fetchInfluencerCount = async () => {
    try {
      const response = await fetch(`/api/requests/campaign/${campaignId}/influencer-count`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });
      const result = await response.json();
      
      if (result.success) {
        setInfluencerCount(result.count);
      }
    } catch (error) {
      console.error('Error fetching influencer count:', error);
    }
  };

  return (
    <div>
      <h2>Campaign Overview</h2>
      <div className="influencer-count">
        <span>Total Applications: {influencerCount}</span>
      </div>
      
      <div className="influencers-list">
        {influencers.map((item) => (
          <div key={item.id} className="influencer-card">
            <img src={item.influencer.profile_image} alt="Profile" />
            <div className="influencer-info">
              <h3>{item.influencer.name}</h3>
              <p>{item.influencer.bio}</p>
              <div className="stats">
                <span>Followers: {item.influencer.followers_count.toLocaleString()}</span>
                <span>Engagement: {item.influencer.engagement_rate}%</span>
              </div>
              <div className="platforms">
                {item.influencer.platforms.map(platform => (
                  <span key={platform} className="platform-tag">{platform}</span>
                ))}
              </div>
              <div className="status">
                Status: <span className={`status-${item.status}`}>{item.status}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## 🧪 Testing

### **Test with cURL**

#### **Get Bid Influencers:**
```bash
curl -X GET http://localhost:3000/api/requests/bid/YOUR_BID_ID/influencers \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### **Get Campaign Influencers:**
```bash
curl -X GET http://localhost:3000/api/requests/campaign/YOUR_CAMPAIGN_ID/influencers \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### **Get Influencer Count:**
```bash
curl -X GET http://localhost:3000/api/requests/bid/YOUR_BID_ID/influencer-count \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## ✅ **Features**

- ✅ **Real-time Updates**: Instant notifications when influencers apply
- ✅ **Live Count**: Real-time influencer count updates
- ✅ **Detailed Profiles**: Complete influencer information
- ✅ **Status Tracking**: Application status monitoring
- ✅ **Permission Control**: Only bid/campaign creators can view
- ✅ **Socket.IO Integration**: WebSocket-based real-time communication

The real-time influencer list system is now fully functional! 🚀
