# 🔧 Frontend API Fix Guide

## 🐛 Issue Identified

The frontend is sending a request to create a bid application, but the backend validation was expecting `campaign_id` instead of `bid_id`.

## ✅ Backend Fixes Applied

### 1. **Updated Validation Rules**
- Added support for `bid_id` field
- Made `campaign_id` optional
- Added validation for `proposed_amount` and `message`

### 2. **Added Database Field**
- Added `proposed_amount` field to `requests` table
- This stores the influencer's initial proposed amount for bids

### 3. **Updated API Endpoint**
- Both campaign and bid applications now use the same endpoint: `POST /api/requests`

## 🔄 API Changes

### **Before (Broken)**
```javascript
// Frontend was sending:
{
  "bid_id": "78cd3b82-6d42-41d5-b932-7a38826ba88c",
  "proposed_amount": 2500,
  "message": "Bid amount: ₹2500"
}

// Backend validation was expecting:
{
  "campaign_id": "uuid" // Required field
}
```

### **After (Fixed)**
```javascript
// Frontend can now send either:
{
  "bid_id": "bid-uuid-here",
  "proposed_amount": 2500,
  "message": "Bid amount: ₹2500"
}

// OR
{
  "campaign_id": "campaign-uuid-here",
  "message": "I'm interested in this campaign"
}
```

## 🚀 Required Actions

### **1. Run Database Migration**
Execute this SQL in your Supabase SQL Editor:
```sql
-- Add proposed_amount field to requests table
ALTER TABLE requests ADD COLUMN IF NOT EXISTS proposed_amount DECIMAL(10,2);

-- Add comment for documentation
COMMENT ON COLUMN requests.proposed_amount IS 'Influencer''s initial proposed amount for bid applications';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_requests_proposed_amount ON requests(proposed_amount);
```

### **2. Deploy Backend Changes**
The backend code has been updated to:
- Accept both `campaign_id` and `bid_id`
- Store `proposed_amount` for bid applications
- Validate all fields properly

### **3. Frontend Should Work Now**
The frontend code should work without changes since it's already sending the correct data format.

## 📋 API Endpoint Summary

### **Create Request (Apply to Campaign/Bid)**
```http
POST /api/requests
Authorization: Bearer <token>
Content-Type: application/json

// For Campaigns:
{
  "campaign_id": "campaign-uuid",
  "message": "I'm interested in this campaign"
}

// For Bids:
{
  "bid_id": "bid-uuid",
  "proposed_amount": 2500,
  "message": "Bid amount: ₹2500"
}
```

### **Response**
```json
{
  "success": true,
  "request": {
    "id": "request-uuid",
    "campaign_id": "campaign-uuid", // or null
    "bid_id": "bid-uuid", // or null
    "influencer_id": "influencer-uuid",
    "status": "connected",
    "proposed_amount": 2500, // for bids only
    "created_at": "2024-01-15T10:30:00Z"
  },
  "conversation": {
    "id": "conversation-uuid",
    "brand_owner_id": "brand-owner-uuid",
    "influencer_id": "influencer-uuid"
  },
  "message": "Application submitted successfully"
}
```

## 🧪 Testing

### **Test Bid Application**
```bash
curl -X POST http://your-api-url/api/requests \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bid_id": "78cd3b82-6d42-41d5-b932-7a38826ba88c",
    "proposed_amount": 2500,
    "message": "Bid amount: ₹2500"
  }'
```

### **Test Campaign Application**
```bash
curl -X POST http://your-api-url/api/requests \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_id": "campaign-uuid-here",
    "message": "I am interested in this campaign"
  }'
```

## ✅ Expected Result

After applying these fixes:
1. **Database migration** - Adds `proposed_amount` field
2. **Backend deployment** - Updated validation and logic
3. **Frontend testing** - Should work without changes

The 400 error should be resolved and bid applications should work properly! 🎉
