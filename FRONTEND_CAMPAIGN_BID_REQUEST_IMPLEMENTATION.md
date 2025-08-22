# 🚀 Frontend Campaign & Bid Request Implementation Guide

## 📋 **Complete Implementation for Influencers to View & Request Campaigns/Bids**

This file contains everything your frontend needs to implement campaign and bid request functionality for influencers.

---

## 🔑 **1. Campaign & Bid API Service**

### **Create: `services/campaignBidApi.ts`**

```typescript
// services/campaignBidApi.ts
import { apiService } from './apiService';

// =====================================================
// INTERFACES & TYPES
// =====================================================

export interface Campaign {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'closed' | 'in_progress';
  start_date: string;
  end_date: string;
  requirements: string;
  deliverables: string[];
  campaign_type: 'product' | 'service' | 'awareness';
  min_budget: number;
  max_budget: number;
  language: string;
  platform: string;
  content_type: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  image_url?: string;
  brand_owner: {
    id: string;
    name: string;
    email: string;
    role: string;
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
  language: string;
  platform: string;
  content_type: string;
  category: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  image_url?: string;
  brand_owner: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

export interface CampaignApplication {
  id: string;
  campaign_id: string;
  influencer_id: string;
  message: string;
  proposed_budget?: number;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface BidApplication {
  id: string;
  bid_id: string;
  influencer_id: string;
  message: string;
  proposed_amount: number;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface CreateApplicationRequest {
  message: string;
  proposed_budget?: number; // For campaigns
  proposed_amount?: number; // For bids
}

// =====================================================
// API METHODS
// =====================================================

export const campaignBidApi = {
  // =====================================================
  // GET AVAILABLE CAMPAIGNS & BIDS
  // =====================================================

  // Get all open campaigns
  fetchOpenCampaigns: async (page: number = 1, limit: number = 20): Promise<{ campaigns: Campaign[], pagination: any }> => {
    try {
      console.log('🔍 Fetching open campaigns...');
      const response = await apiService.get(`/api/campaigns?status=open&page=${page}&limit=${limit}`);
      console.log('✅ Open campaigns response:', response);
      
      if (response.success) {
        return {
          campaigns: response.campaigns || [],
          pagination: response.pagination || {}
        };
      }
      
      throw new Error('Failed to fetch campaigns');
    } catch (error) {
      console.error('❌ Error fetching open campaigns:', error);
      throw error;
    }
  },

  // Get all open bids
  fetchOpenBids: async (page: number = 1, limit: number = 20): Promise<{ bids: Bid[], pagination: any }> => {
    try {
      console.log('🔍 Fetching open bids...');
      const response = await apiService.get(`/api/bids?status=open&page=${page}&limit=${limit}`);
      console.log('✅ Open bids response:', response);
      
      if (response.success) {
        return {
          bids: response.bids || [],
          pagination: response.pagination || {}
        };
      }
      
      throw new Error('Failed to fetch bids');
    } catch (error) {
      console.error('❌ Error fetching open bids:', error);
      throw error;
    }
  },

  // Get campaign details
  fetchCampaignDetails: async (campaignId: string): Promise<Campaign> => {
    try {
      console.log(`🔍 Fetching campaign details for ${campaignId}...`);
      const response = await apiService.get(`/api/campaigns/${campaignId}`);
      console.log('✅ Campaign details response:', response);
      
      if (response.success && response.campaign) {
        return response.campaign;
      }
      
      throw new Error('Failed to fetch campaign details');
    } catch (error) {
      console.error('❌ Error fetching campaign details:', error);
      throw error;
    }
  },

  // Get bid details
  fetchBidDetails: async (bidId: string): Promise<Bid> => {
    try {
      console.log(`🔍 Fetching bid details for ${bidId}...`);
      const response = await apiService.get(`/api/bids/${bidId}`);
      console.log('✅ Bid details response:', response);
      
      if (response.success && response.bid) {
        return response.bid;
      }
      
      throw new Error('Failed to fetch bid details');
    } catch (error) {
      console.error('❌ Error fetching bid details:', error);
      throw error;
    }
  },

  // =====================================================
  // APPLY FOR CAMPAIGNS & BIDS
  // =====================================================

  // Apply for a campaign
  applyForCampaign: async (campaignId: string, request: CreateApplicationRequest): Promise<{ application_id: string }> => {
    try {
      console.log(`🔍 Applying for campaign ${campaignId}...`, request);
      const response = await apiService.post(`/api/campaigns/${campaignId}/apply`, {
        message: request.message,
        proposed_budget: request.proposed_budget
      });
      console.log('✅ Campaign application response:', response);
      
      if (response.success && response.application_id) {
        return { application_id: response.application_id };
      }
      
      throw new Error('Failed to apply for campaign');
    } catch (error) {
      console.error('❌ Error applying for campaign:', error);
      throw error;
    }
  },

  // Apply for a bid
  applyForBid: async (bidId: string, request: CreateApplicationRequest): Promise<{ application_id: string }> => {
    try {
      console.log(`🔍 Applying for bid ${bidId}...`, request);
      const response = await apiService.post(`/api/bids/${bidId}/apply`, {
        message: request.message,
        proposed_amount: request.proposed_amount
      });
      console.log('✅ Bid application response:', response);
      
      if (response.success && response.application_id) {
        return { application_id: response.application_id };
      }
      
      throw new Error('Failed to apply for bid');
    } catch (error) {
      console.error('❌ Error applying for bid:', error);
      throw error;
    }
  },

  // =====================================================
  // VIEW APPLICATIONS & STATUS
  // =====================================================

  // Get influencer's campaign applications
  fetchMyCampaignApplications: async (): Promise<CampaignApplication[]> => {
    try {
      console.log('🔍 Fetching my campaign applications...');
      const response = await apiService.get('/api/campaigns/my-applications');
      console.log('✅ My campaign applications response:', response);
      
      if (response.success) {
        return response.applications || [];
      }
      
      throw new Error('Failed to fetch campaign applications');
    } catch (error) {
      console.error('❌ Error fetching campaign applications:', error);
      throw error;
    }
  },

  // Get influencer's bid applications
  fetchMyBidApplications: async (): Promise<BidApplication[]> => {
    try {
      console.log('🔍 Fetching my bid applications...');
      const response = await apiService.get('/api/bids/my-applications');
      console.log('✅ My bid applications response:', response);
      
      if (response.success) {
        return response.applications || [];
      }
      
      throw new Error('Failed to fetch bid applications');
    } catch (error) {
      console.error('❌ Error fetching bid applications:', error);
      throw error;
    }
  },

  // =====================================================
  // SEARCH & FILTER
  // =====================================================

  // Search campaigns
  searchCampaigns: async (query: string, filters: any = {}): Promise<{ campaigns: Campaign[], pagination: any }> => {
    try {
      console.log('🔍 Searching campaigns...', { query, filters });
      const queryParams = new URLSearchParams({
        q: query,
        ...filters
      });
      
      const response = await apiService.get(`/api/campaigns/search?${queryParams}`);
      console.log('✅ Campaign search response:', response);
      
      if (response.success) {
        return {
          campaigns: response.campaigns || [],
          pagination: response.pagination || {}
        };
      }
      
      throw new Error('Failed to search campaigns');
    } catch (error) {
      console.error('❌ Error searching campaigns:', error);
      throw error;
    }
  },

  // Search bids
  searchBids: async (query: string, filters: any = {}): Promise<{ bids: Bid[], pagination: any }> => {
    try {
      console.log('🔍 Searching bids...', { query, filters });
      const queryParams = new URLSearchParams({
        q: query,
        ...filters
      });
      
      const response = await apiService.get(`/api/bids/search?${queryParams}`);
      console.log('✅ Bid search response:', response);
      
      if (response.success) {
        return {
          bids: response.bids || [],
          pagination: response.pagination || {}
        };
      }
      
      throw new Error('Failed to search bids');
    } catch (error) {
      console.error('❌ Error searching bids:', error);
      throw error;
    }
  }
};
```

---

## 📱 **2. Campaign & Bid List Screen**

### **Create: `components/CampaignBidListScreen.tsx`**

```typescript
// components/CampaignBidListScreen.tsx
import React, { useState, useEffect } from 'react';
import { campaignBidApi, Campaign, Bid } from '../services/campaignBidApi';
import { CampaignCard } from './CampaignCard';
import { BidCard } from './BidCard';
import { SearchFilters } from './SearchFilters';
import { ApplicationModal } from './ApplicationModal';

export const CampaignBidListScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'bids'>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    minBudget: '',
    maxBudget: '',
    platform: '',
    contentType: '',
    language: ''
  });
  const [showApplicationModal, setShowApplicationModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Campaign | Bid | null>(null);
  const [applicationType, setApplicationType] = useState<'campaign' | 'bid'>('campaign');

  // =====================================================
  // LOAD DATA
  // =====================================================

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const { campaigns: campaignData } = await campaignBidApi.fetchOpenCampaigns();
      setCampaigns(campaignData);
    } catch (error) {
      console.error('Failed to load campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBids = async () => {
    try {
      setLoading(true);
      const { bids: bidData } = await campaignBidApi.fetchOpenBids();
      setBids(bidData);
    } catch (error) {
      console.error('Failed to load bids:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'campaigns') {
      loadCampaigns();
    } else {
      loadBids();
    }
  }, [activeTab]);

  // =====================================================
  // SEARCH & FILTER
  // =====================================================

  const handleSearch = async () => {
    try {
      setLoading(true);
      
      if (activeTab === 'campaigns') {
        const { campaigns: searchResults } = await campaignBidApi.searchCampaigns(searchQuery, filters);
        setCampaigns(searchResults);
      } else {
        const { bids: searchResults } = await campaignBidApi.searchBids(searchQuery, filters);
        setBids(searchResults);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newFilters: any) => {
    setFilters(newFilters);
  };

  // =====================================================
  // APPLY FOR ITEM
  // =====================================================

  const handleApply = (item: Campaign | Bid) => {
    setSelectedItem(item);
    setApplicationType(activeTab === 'campaigns' ? 'campaign' : 'bid');
    setShowApplicationModal(true);
  };

  const handleApplicationSubmit = async (applicationData: any) => {
    try {
      if (!selectedItem) return;

      if (applicationType === 'campaign') {
        const campaign = selectedItem as Campaign;
        await campaignBidApi.applyForCampaign(campaign.id, applicationData);
        alert('Campaign application submitted successfully!');
      } else {
        const bid = selectedItem as Bid;
        await campaignBidApi.applyForBid(bid.id, applicationData);
        alert('Bid application submitted successfully!');
      }

      setShowApplicationModal(false);
      setSelectedItem(null);
      
      // Refresh the list
      if (activeTab === 'campaigns') {
        loadCampaigns();
      } else {
        loadBids();
      }
      
    } catch (error) {
      console.error('Application failed:', error);
      alert('Failed to submit application. Please try again.');
    }
  };

  // =====================================================
  // RENDER
  // =====================================================

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner">Loading {activeTab}...</div>
      </div>
    );
  }

  return (
    <div className="campaign-bid-screen">
      {/* Header */}
      <div className="screen-header">
        <h1>Discover Opportunities</h1>
        <p>Find campaigns and bids that match your skills</p>
      </div>

      {/* Tabs */}
      <div className="tab-navigation">
        <button 
          className={`tab-button ${activeTab === 'campaigns' ? 'active' : ''}`}
          onClick={() => setActiveTab('campaigns')}
        >
          🎯 Campaigns ({campaigns.length})
        </button>
        <button 
          className={`tab-button ${activeTab === 'bids' ? 'active' : ''}`}
          onClick={() => setActiveTab('bids')}
        >
          💰 Bids ({bids.length})
        </button>
      </div>

      {/* Search & Filters */}
      <SearchFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filters={filters}
        onFilterChange={handleFilterChange}
        onSearch={handleSearch}
        contentType={activeTab}
      />

      {/* Content */}
      <div className="content-area">
        {activeTab === 'campaigns' ? (
          <div className="campaigns-grid">
            {campaigns.length === 0 ? (
              <div className="empty-state">
                <h3>No campaigns found</h3>
                <p>Try adjusting your search or filters</p>
              </div>
            ) : (
              campaigns.map(campaign => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onApply={() => handleApply(campaign)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="bids-grid">
            {bids.length === 0 ? (
              <div className="empty-state">
                <h3>No bids found</h3>
                <p>Try adjusting your search or filters</p>
              </div>
            ) : (
              bids.map(bid => (
                <BidCard
                  key={bid.id}
                  bid={bid}
                  onApply={() => handleApply(bid)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Application Modal */}
      {showApplicationModal && selectedItem && (
        <ApplicationModal
          type={applicationType}
          item={selectedItem}
          onClose={() => setShowApplicationModal(false)}
          onSubmit={handleApplicationSubmit}
        />
      )}
    </div>
  );
};
```

---

## 🎯 **3. Campaign Card Component**

### **Create: `components/CampaignCard.tsx`**

```typescript
// components/CampaignCard.tsx
import React from 'react';
import { Campaign } from '../services/campaignBidApi';

interface CampaignCardProps {
  campaign: Campaign;
  onApply: () => void;
}

export const CampaignCard: React.FC<CampaignCardProps> = ({ campaign, onApply }) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatBudget = (min: number, max: number) => {
    return `$${min.toLocaleString()} - $${max.toLocaleString()}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'status-open';
      case 'closed': return 'status-closed';
      case 'in_progress': return 'status-progress';
      default: return 'status-unknown';
    }
  };

  return (
    <div className="campaign-card">
      {/* Campaign Image */}
      {campaign.image_url && (
        <div className="campaign-image">
          <img src={campaign.image_url} alt={campaign.title} />
        </div>
      )}

      {/* Campaign Content */}
      <div className="campaign-content">
        {/* Header */}
        <div className="campaign-header">
          <h3 className="campaign-title">{campaign.title}</h3>
          <span className={`campaign-status ${getStatusColor(campaign.status)}`}>
            {campaign.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        {/* Description */}
        <p className="campaign-description">{campaign.description}</p>

        {/* Key Details */}
        <div className="campaign-details">
          <div className="detail-item">
            <span className="detail-label">💰 Budget:</span>
            <span className="detail-value">{formatBudget(campaign.min_budget, campaign.max_budget)}</span>
          </div>
          
          <div className="detail-item">
            <span className="detail-label">📱 Platform:</span>
            <span className="detail-value">{campaign.platform}</span>
          </div>
          
          <div className="detail-item">
            <span className="detail-label">🎬 Content:</span>
            <span className="detail-value">{campaign.content_type}</span>
          </div>
          
          <div className="detail-item">
            <span className="detail-label">🌍 Language:</span>
            <span className="detail-value">{campaign.language}</span>
          </div>
        </div>

        {/* Requirements */}
        <div className="campaign-requirements">
          <h4>Requirements:</h4>
          <p>{campaign.requirements}</p>
        </div>

        {/* Deliverables */}
        <div className="campaign-deliverables">
          <h4>Deliverables:</h4>
          <div className="deliverables-list">
            {campaign.deliverables.map((deliverable, index) => (
              <span key={index} className="deliverable-tag">
                {deliverable}
              </span>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="campaign-timeline">
          <div className="timeline-item">
            <span className="timeline-label">Start:</span>
            <span className="timeline-date">{formatDate(campaign.start_date)}</span>
          </div>
          <div className="timeline-item">
            <span className="timeline-label">End:</span>
            <span className="timeline-date">{formatDate(campaign.end_date)}</span>
          </div>
        </div>

        {/* Brand Owner */}
        <div className="brand-owner">
          <span className="brand-label">Brand:</span>
          <span className="brand-name">{campaign.brand_owner.name}</span>
        </div>

        {/* Action Button */}
        <div className="campaign-actions">
          <button 
            className="apply-button"
            onClick={onApply}
            disabled={campaign.status !== 'open'}
          >
            {campaign.status === 'open' ? 'Apply Now' : 'Applications Closed'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

---

## 💰 **4. Bid Card Component**

### **Create: `components/BidCard.tsx`**

```typescript
// components/BidCard.tsx
import React from 'react';
import { Bid } from '../services/campaignBidApi';

interface BidCardProps {
  bid: Bid;
  onApply: () => void;
}

export const BidCard: React.FC<BidCardProps> = ({ bid, onApply }) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatBudget = (min: number, max: number) => {
    return `$${min.toLocaleString()} - $${max.toLocaleString()}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'status-open';
      case 'closed': return 'status-closed';
      case 'in_progress': return 'status-progress';
      default: return 'status-unknown';
    }
  };

  return (
    <div className="bid-card">
      {/* Bid Image */}
      {bid.image_url && (
        <div className="bid-image">
          <img src={bid.image_url} alt={bid.title} />
        </div>
      )}

      {/* Bid Content */}
      <div className="bid-content">
        {/* Header */}
        <div className="bid-header">
          <h3 className="bid-title">{bid.title}</h3>
          <span className={`bid-status ${getStatusColor(bid.status)}`}>
            {bid.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        {/* Description */}
        <p className="bid-description">{bid.description}</p>

        {/* Key Details */}
        <div className="bid-details">
          <div className="detail-item">
            <span className="detail-label">💰 Budget:</span>
            <span className="detail-value">{formatBudget(bid.min_budget, bid.max_budget)}</span>
          </div>
          
          <div className="detail-item">
            <span className="detail-label">📱 Platform:</span>
            <span className="detail-value">{bid.platform}</span>
          </div>
          
          <div className="detail-item">
            <span className="detail-label">🎬 Content:</span>
            <span className="detail-value">{bid.content_type}</span>
          </div>
          
          <div className="detail-item">
            <span className="detail-label">🏷️ Category:</span>
            <span className="detail-value">{bid.category}</span>
          </div>
          
          <div className="detail-item">
            <span className="detail-label">🌍 Language:</span>
            <span className="detail-value">{bid.language}</span>
          </div>
        </div>

        {/* Requirements */}
        <div className="bid-requirements">
          <h4>Requirements:</h4>
          <p>{bid.requirements}</p>
        </div>

        {/* Brand Owner */}
        <div className="brand-owner">
          <span className="brand-label">Client:</span>
          <span className="brand-name">{bid.brand_owner.name}</span>
        </div>

        {/* Action Button */}
        <div className="bid-actions">
          <button 
            className="apply-button"
            onClick={onApply}
            disabled={bid.status !== 'open'}
          >
            {bid.status === 'open' ? 'Submit Proposal' : 'Proposals Closed'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

---

## 📝 **5. Application Modal Component**

### **Create: `components/ApplicationModal.tsx`**

```typescript
// components/ApplicationModal.tsx
import React, { useState, useEffect } from 'react';
import { Campaign, Bid, CreateApplicationRequest } from '../services/campaignBidApi';

interface ApplicationModalProps {
  type: 'campaign' | 'bid';
  item: Campaign | Bid;
  onClose: () => void;
  onSubmit: (data: CreateApplicationRequest) => Promise<void>;
}

export const ApplicationModal: React.FC<ApplicationModalProps> = ({
  type,
  item,
  onClose,
  onSubmit
}) => {
  const [message, setMessage] = useState('');
  const [proposedBudget, setProposedBudget] = useState('');
  const [proposedAmount, setProposedAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Set default message based on type
  useEffect(() => {
    if (type === 'campaign') {
      const campaign = item as Campaign;
      setMessage(`I'm interested in your "${campaign.title}" campaign! I have experience in ${campaign.content_type} content creation and would love to collaborate.`);
    } else {
      const bid = item as Bid;
      setMessage(`I'm excited about your "${bid.title}" project! I specialize in ${bid.content_type} content and would be perfect for this opportunity.`);
    }
  }, [type, item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!message.trim()) {
      alert('Please enter a message');
      return;
    }

    try {
      setSubmitting(true);
      
      const applicationData: CreateApplicationRequest = {
        message: message.trim(),
        ...(type === 'campaign' && proposedBudget && { proposed_budget: parseFloat(proposedBudget) }),
        ...(type === 'bid' && proposedAmount && { proposed_amount: parseFloat(proposedAmount) })
      };

      await onSubmit(applicationData);
      
    } catch (error) {
      console.error('Application submission failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const getTitle = () => {
    if (type === 'campaign') {
      const campaign = item as Campaign;
      return `Apply for: ${campaign.title}`;
    } else {
      const bid = item as Bid;
      return `Submit Proposal for: ${bid.title}`;
    }
  };

  const getBudgetRange = () => {
    if (type === 'campaign') {
      const campaign = item as Campaign;
      return `Budget Range: $${campaign.min_budget.toLocaleString()} - $${campaign.max_budget.toLocaleString()}`;
    } else {
      const bid = item as Bid;
      return `Budget Range: $${bid.min_budget.toLocaleString()} - $${bid.max_budget.toLocaleString()}`;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{getTitle()}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Budget Info */}
          <div className="budget-info">
            <p className="budget-range">{getBudgetRange()}</p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Message */}
            <div className="form-group">
              <label htmlFor="message">Your Message *</label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Explain why you're perfect for this opportunity..."
                rows={6}
                required
              />
              <small>Tell them about your experience and why you're the right fit</small>
            </div>

            {/* Proposed Budget/Amount */}
            {type === 'campaign' ? (
              <div className="form-group">
                <label htmlFor="proposedBudget">Proposed Budget (Optional)</label>
                <input
                  id="proposedBudget"
                  type="number"
                  value={proposedBudget}
                  onChange={(e) => setProposedBudget(e.target.value)}
                  placeholder="Enter your proposed budget"
                  min="0"
                  step="0.01"
                />
                <small>Leave empty to use the campaign's budget range</small>
              </div>
            ) : (
              <div className="form-group">
                <label htmlFor="proposedAmount">Proposed Amount *</label>
                <input
                  id="proposedAmount"
                  type="number"
                  value={proposedAmount}
                  onChange={(e) => setProposedAmount(e.target.value)}
                  placeholder="Enter your proposed amount"
                  min="0"
                  step="0.01"
                  required
                />
                <small>This is your bid amount for the project</small>
              </div>
            )}

            {/* Submit Button */}
            <div className="form-actions">
              <button 
                type="button" 
                className="cancel-btn" 
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="submit-btn"
                disabled={submitting}
              >
                {submitting ? 'Submitting...' : type === 'campaign' ? 'Apply Now' : 'Submit Proposal'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
```

---

## 🔍 **6. Search & Filters Component**

### **Create: `components/SearchFilters.tsx`**

```typescript
// components/SearchFilters.tsx
import React, { useState } from 'react';

interface SearchFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters: {
    minBudget: string;
    maxBudget: string;
    platform: string;
    contentType: string;
    language: string;
  };
  onFilterChange: (filters: any) => void;
  onSearch: () => void;
  contentType: 'campaigns' | 'bids';
}

export const SearchFilters: React.FC<SearchFiltersProps> = ({
  searchQuery,
  onSearchChange,
  filters,
  onFilterChange,
  onSearch,
  contentType
}) => {
  const [showFilters, setShowFilters] = useState(false);

  const handleFilterChange = (key: string, value: string) => {
    onFilterChange({
      ...filters,
      [key]: value
    });
  };

  const clearFilters = () => {
    onFilterChange({
      minBudget: '',
      maxBudget: '',
      platform: '',
      contentType: '',
      language: ''
    });
  };

  const platforms = ['Instagram', 'TikTok', 'YouTube', 'Twitter', 'Facebook', 'LinkedIn'];
  const contentTypes = ['Image', 'Video', 'Story', 'Reel', 'Post', 'Article'];
  const languages = ['English', 'Hindi', 'Spanish', 'French', 'German', 'Chinese'];

  return (
    <div className="search-filters">
      {/* Search Bar */}
      <div className="search-bar">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={`Search ${contentType}...`}
          className="search-input"
        />
        <button onClick={onSearch} className="search-btn">
          🔍 Search
        </button>
      </div>

      {/* Filters Toggle */}
      <div className="filters-toggle">
        <button 
          onClick={() => setShowFilters(!showFilters)}
          className="filters-toggle-btn"
        >
          {showFilters ? 'Hide Filters' : 'Show Filters'}
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filters-grid">
            {/* Budget Range */}
            <div className="filter-group">
              <label>Budget Range</label>
              <div className="budget-inputs">
                <input
                  type="number"
                  placeholder="Min"
                  value={filters.minBudget}
                  onChange={(e) => handleFilterChange('minBudget', e.target.value)}
                  className="budget-input"
                />
                <span>-</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filters.maxBudget}
                  onChange={(e) => handleFilterChange('maxBudget', e.target.value)}
                  className="budget-input"
                />
              </div>
            </div>

            {/* Platform */}
            <div className="filter-group">
              <label>Platform</label>
              <select
                value={filters.platform}
                onChange={(e) => handleFilterChange('platform', e.target.value)}
                className="filter-select"
              >
                <option value="">All Platforms</option>
                {platforms.map(platform => (
                  <option key={platform} value={platform}>{platform}</option>
                ))}
              </select>
            </div>

            {/* Content Type */}
            <div className="filter-group">
              <label>Content Type</label>
              <select
                value={filters.contentType}
                onChange={(e) => handleFilterChange('contentType', e.target.value)}
                className="filter-select"
              >
                <option value="">All Types</option>
                {contentTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {/* Language */}
            <div className="filter-group">
              <label>Language</label>
              <select
                value={filters.language}
                onChange={(e) => handleFilterChange('language', e.target.value)}
                className="filter-select"
              >
                <option value="">All Languages</option>
                {languages.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter Actions */}
          <div className="filter-actions">
            <button onClick={clearFilters} className="clear-filters-btn">
              Clear Filters
            </button>
            <button onClick={onSearch} className="apply-filters-btn">
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
```

---

## 📊 **7. API Response Examples**

### **✅ Open Campaigns Response:**
```json
{
  "success": true,
  "campaigns": [
    {
      "id": "camp_123",
      "title": "Tech Product Launch Campaign",
      "description": "Promote our new tech product across social media",
      "status": "open",
      "start_date": "2025-01-25",
      "end_date": "2025-02-25",
      "requirements": "Tech-savvy influencers with 10K+ followers",
      "deliverables": ["Instagram Post", "Story", "Reel"],
      "campaign_type": "product",
      "min_budget": 500,
      "max_budget": 2000,
      "language": "English",
      "platform": "Instagram",
      "content_type": "Video",
      "brand_owner": {
        "id": "user_456",
        "name": "TechCorp",
        "email": "brand@techcorp.com",
        "role": "brand_owner"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

### **✅ Open Bids Response:**
```json
{
  "success": true,
  "bids": [
    {
      "id": "bid_789",
      "title": "Instagram Post for Fashion Brand",
      "description": "Create engaging content for our fashion collection",
      "status": "open",
      "min_budget": 200,
      "max_budget": 800,
      "requirements": "Fashion influencers with aesthetic content",
      "language": "English",
      "platform": "Instagram",
      "content_type": "Image",
      "category": "Fashion",
      "brand_owner": {
        "id": "user_789",
        "name": "FashionBrand",
        "email": "brand@fashion.com",
        "role": "brand_owner"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

### **✅ Campaign Application Response:**
```json
{
  "success": true,
  "application_id": "app_123",
  "message": "Application submitted successfully"
}
```

### **✅ Bid Application Response:**
```json
{
  "success": true,
  "application_id": "app_456",
  "message": "Proposal submitted successfully"
}
```

---

## 🎯 **8. Implementation Steps**

### **Step 1: Create all the files above**
1. `services/campaignBidApi.ts`
2. `components/CampaignBidListScreen.tsx`
3. `components/CampaignCard.tsx`
4. `components/BidCard.tsx`
5. `components/ApplicationModal.tsx`
6. `components/SearchFilters.tsx`

### **Step 2: Add to your main navigation**
```typescript
// In your main app navigation
<Route path="/opportunities" component={CampaignBidListScreen} />
```

### **Step 3: Test the functionality**
Your frontend will now:
- ✅ **Display open campaigns** with full details
- ✅ **Display open bids** with full details
- ✅ **Allow influencers to apply** for campaigns
- ✅ **Allow influencers to submit proposals** for bids
- ✅ **Search and filter** opportunities
- ✅ **Handle all API responses** correctly

---

## 🎉 **What You Get:**

### **✅ Complete Opportunity Discovery:**
- **Campaign browsing** - View all open campaigns
- **Bid browsing** - View all open bids
- **Detailed information** - Full campaign/bid details
- **Search functionality** - Find specific opportunities
- **Advanced filtering** - Filter by budget, platform, content type

### **✅ Application System:**
- **Campaign applications** - Apply with custom messages
- **Bid proposals** - Submit proposals with amounts
- **Professional forms** - User-friendly application process
- **Status tracking** - View application status

### **✅ Professional UX:**
- **Responsive design** - Works on all devices
- **Loading states** - Professional loading indicators
- **Error handling** - User-friendly error messages
- **Success feedback** - Confirmation of actions

**Your influencers will now have a complete system to discover and apply for campaigns and bids!** 🚀

**Copy these files and you'll have a fully functional opportunity discovery and application system!** 🎯
