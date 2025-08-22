# 🚀 Frontend Campaign & Bid Request Implementation Guide

## 📋 **Complete Implementation for Influencers to View & Request Campaigns/Bids**

This file contains everything your frontend needs to implement campaign and bid request functionality for influencers.

---

## 🔑 **1. Campaign & Bid API Service**

### **Create: `services/campaignBidApi.ts`**

```typescript
import { apiService } from './apiService';

export interface Campaign {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'closed' | 'in_progress';
  min_budget: number;
  max_budget: number;
  requirements: string;
  platform: string;
  content_type: string;
  language: string;
  brand_owner: {
    id: string;
    name: string;
    email: string;
  };
}

export interface Bid {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'closed' | 'in_progress';
  min_budget: number;
  max_budget: number;
  requirements: string;
  platform: string;
  content_type: string;
  category: string;
  brand_owner: {
    id: string;
    name: string;
    email: string;
  };
}

export const campaignBidApi = {
  // Get open campaigns
  fetchOpenCampaigns: async (): Promise<Campaign[]> => {
    const response = await apiService.get('/api/campaigns?status=open');
    return response.campaigns || [];
  },

  // Get open bids
  fetchOpenBids: async (): Promise<Bid[]> => {
    const response = await apiService.get('/api/bids?status=open');
    return response.bids || [];
  },

  // Apply for campaign
  applyForCampaign: async (campaignId: string, message: string, proposedBudget?: number) => {
    const response = await apiService.post(`/api/campaigns/${campaignId}/apply`, {
      message,
      proposed_budget: proposedBudget
    });
    return response.application_id;
  },

  // Apply for bid
  applyForBid: async (bidId: string, message: string, proposedAmount: number) => {
    const response = await apiService.post(`/api/bids/${bidId}/apply`, {
      message,
      proposed_amount: proposedAmount
    });
    return response.application_id;
  }
};
```

---

## 📱 **2. Main Opportunities Screen**

### **Create: `components/OpportunitiesScreen.tsx`**

```typescript
import React, { useState, useEffect } from 'react';
import { campaignBidApi, Campaign, Bid } from '../services/campaignBidApi';

export const OpportunitiesScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'bids'>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [campaignsData, bidsData] = await Promise.all([
        campaignBidApi.fetchOpenCampaigns(),
        campaignBidApi.fetchOpenBids()
      ]);
      setCampaigns(campaignsData);
      setBids(bidsData);
    } catch (error) {
      console.error('Failed to load opportunities:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (type: 'campaign' | 'bid', item: Campaign | Bid) => {
    try {
      const message = prompt('Enter your application message:');
      if (!message) return;

      if (type === 'campaign') {
        const campaign = item as Campaign;
        const proposedBudget = prompt('Enter proposed budget (optional):');
        const budget = proposedBudget ? parseFloat(proposedBudget) : undefined;
        
        await campaignBidApi.applyForCampaign(campaign.id, message, budget);
        alert('Campaign application submitted successfully!');
      } else {
        const bid = item as Bid;
        const proposedAmount = prompt('Enter your proposed amount:');
        if (!proposedAmount) return;
        
        await campaignBidApi.applyForBid(bid.id, message, parseFloat(proposedAmount));
        alert('Bid proposal submitted successfully!');
      }
      
      loadData(); // Refresh list
    } catch (error) {
      console.error('Application failed:', error);
      alert('Failed to submit application');
    }
  };

  if (loading) {
    return <div>Loading opportunities...</div>;
  }

  return (
    <div className="opportunities-screen">
      <h1>Discover Opportunities</h1>
      
      {/* Tabs */}
      <div className="tabs">
        <button 
          className={activeTab === 'campaigns' ? 'active' : ''} 
          onClick={() => setActiveTab('campaigns')}
        >
          🎯 Campaigns ({campaigns.length})
        </button>
        <button 
          className={activeTab === 'bids' ? 'active' : ''} 
          onClick={() => setActiveTab('bids')}
        >
          💰 Bids ({bids.length})
        </button>
      </div>

      {/* Content */}
      {activeTab === 'campaigns' ? (
        <div className="campaigns-grid">
          {campaigns.map(campaign => (
            <div key={campaign.id} className="campaign-card">
              <h3>{campaign.title}</h3>
              <p>{campaign.description}</p>
              <div className="campaign-details">
                <p>💰 Budget: ${campaign.min_budget} - ${campaign.max_budget}</p>
                <p>📱 Platform: {campaign.platform}</p>
                <p>🎬 Content: {campaign.content_type}</p>
                <p>🌍 Language: {campaign.language}</p>
                <p>🏢 Brand: {campaign.brand_owner.name}</p>
              </div>
              <button 
                onClick={() => handleApply('campaign', campaign)}
                className="apply-btn"
              >
                Apply Now
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="bids-grid">
          {bids.map(bid => (
            <div key={bid.id} className="bid-card">
              <h3>{bid.title}</h3>
              <p>{bid.description}</p>
              <div className="bid-details">
                <p>💰 Budget: ${bid.min_budget} - ${bid.max_budget}</p>
                <p>📱 Platform: {bid.platform}</p>
                <p>🎬 Content: {bid.content_type}</p>
                <p>🏷️ Category: {bid.category}</p>
                <p>🌍 Language: {bid.language}</p>
                <p>🏢 Client: {bid.brand_owner.name}</p>
              </div>
              <button 
                onClick={() => handleApply('bid', bid)}
                className="apply-btn"
              >
                Submit Proposal
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

---

## 📊 **3. API Response Examples**

### **✅ Open Campaigns Response:**
```json
{
  "success": true,
  "campaigns": [
    {
      "id": "camp_123",
      "title": "Tech Product Launch",
      "description": "Promote our new tech product",
      "status": "open",
      "min_budget": 500,
      "max_budget": 2000,
      "requirements": "Tech-savvy influencers",
      "platform": "Instagram",
      "content_type": "Video",
      "language": "English",
      "brand_owner": {
        "id": "user_456",
        "name": "TechCorp",
        "email": "brand@techcorp.com"
      }
    }
  ]
}
```

### **✅ Open Bids Response:**
```json
{
  "success": true,
  "bids": [
    {
      "id": "bid_789",
      "title": "Instagram Post for Fashion",
      "description": "Create fashion content",
      "status": "open",
      "min_budget": 200,
      "max_budget": 800,
      "requirements": "Fashion influencers",
      "platform": "Instagram",
      "content_type": "Image",
      "category": "Fashion",
      "language": "English",
      "brand_owner": {
        "id": "user_789",
        "name": "FashionBrand",
        "email": "brand@fashion.com"
      }
    }
  ]
}
```

### **✅ Application Response:**
```json
{
  "success": true,
  "application_id": "app_123",
  "message": "Application submitted successfully"
}
```

---

## 🎯 **4. Implementation Steps**

### **Step 1: Create the files above**
1. `services/campaignBidApi.ts`
2. `components/OpportunitiesScreen.tsx`

### **Step 2: Add to your navigation**
```typescript
// In your main app
<Route path="/opportunities" component={OpportunitiesScreen} />
```

### **Step 3: Test the functionality**
Your frontend will now:
- ✅ **Display open campaigns** with full details
- ✅ **Display open bids** with full details
- ✅ **Allow influencers to apply** for campaigns
- ✅ **Allow influencers to submit proposals** for bids
- ✅ **Handle all API responses** correctly

---

## 🎉 **What You Get:**

### **✅ Complete Opportunity Discovery:**
- **Campaign browsing** - View all open campaigns
- **Bid browsing** - View all open bids
- **Detailed information** - Full campaign/bid details
- **Application system** - Apply with custom messages

### **✅ Professional Features:**
- **Tabbed interface** - Switch between campaigns and bids
- **Apply buttons** - Easy application process
- **Budget display** - Clear budget information
- **Brand information** - See who's posting opportunities

**Your influencers will now have a complete system to discover and apply for campaigns and bids!** 🚀

**Copy these files and you'll have a fully functional opportunity discovery and application system!** 🎯
