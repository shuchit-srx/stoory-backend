# 🧪 API Testing Guide - Request Creation

## 🎯 Testing the Fixed Request API

### **Endpoint**: `POST /api/requests`

## ✅ Test Cases

### **1. Test Bid Application (Should Work)**
```bash
curl -X POST http://192.168.0.106:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "bid_id": "78cd3b82-6d42-41d5-b932-7a38826ba88c",
    "proposed_amount": 2500,
    "message": "Bid amount: ₹2500"
  }'
```

**Expected Response (201)**:
```json
{
  "success": true,
  "request": {
    "id": "request-uuid",
    "bid_id": "78cd3b82-6d42-41d5-b932-7a38826ba88c",
    "campaign_id": null,
    "influencer_id": "influencer-uuid",
    "status": "connected",
    "proposed_amount": 2500,
    "message": "Bid amount: ₹2500",
    "created_at": "2024-01-15T10:30:00Z"
  },
  "conversation": {
    "id": "conversation-uuid",
    "brand_owner_id": "brand-owner-uuid",
    "influencer_id": "influencer-uuid",
    "bid_id": "78cd3b82-6d42-41d5-b932-7a38826ba88c",
    "campaign_id": null
  },
  "message": "Application submitted successfully"
}
```

### **2. Test Campaign Application (Should Work)**
```bash
curl -X POST http://192.168.0.106:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "campaign_id": "campaign-uuid-here",
    "message": "I am interested in this campaign"
  }'
```

**Expected Response (201)**:
```json
{
  "success": true,
  "request": {
    "id": "request-uuid",
    "campaign_id": "campaign-uuid-here",
    "bid_id": null,
    "influencer_id": "influencer-uuid",
    "status": "connected",
    "proposed_amount": null,
    "message": "I am interested in this campaign",
    "created_at": "2024-01-15T10:30:00Z"
  },
  "conversation": {
    "id": "conversation-uuid",
    "brand_owner_id": "brand-owner-uuid",
    "influencer_id": "influencer-uuid",
    "campaign_id": "campaign-uuid-here",
    "bid_id": null
  },
  "message": "Application submitted successfully"
}
```

### **3. Test Missing Both IDs (Should Fail)**
```bash
curl -X POST http://192.168.0.106:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "This should fail"
  }'
```

**Expected Response (400)**:
```json
{
  "errors": [
    {
      "msg": "Either campaign_id or bid_id is required",
      "param": "_error",
      "location": "body"
    }
  ]
}
```

### **4. Test Both IDs Provided (Should Fail)**
```bash
curl -X POST http://192.168.0.106:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "campaign_id": "campaign-uuid",
    "bid_id": "bid-uuid",
    "proposed_amount": 2500,
    "message": "This should fail"
  }'
```

**Expected Response (400)**:
```json
{
  "errors": [
    {
      "msg": "Cannot provide both campaign_id and bid_id",
      "param": "_error",
      "location": "body"
    }
  ]
}
```

### **5. Test Invalid UUID (Should Fail)**
```bash
curl -X POST http://192.168.0.106:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "bid_id": "invalid-uuid",
    "proposed_amount": 2500,
    "message": "This should fail"
  }'
```

**Expected Response (400)**:
```json
{
  "errors": [
    {
      "msg": "Invalid bid ID format",
      "param": "bid_id",
      "location": "body"
    }
  ]
}
```

### **6. Test Negative Proposed Amount (Should Fail)**
```bash
curl -X POST http://192.168.0.106:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "bid_id": "78cd3b82-6d42-41d5-b932-7a38826ba88c",
    "proposed_amount": -100,
    "message": "This should fail"
  }'
```

**Expected Response (400)**:
```json
{
  "errors": [
    {
      "msg": "Proposed amount must be a positive number",
      "param": "proposed_amount",
      "location": "body"
    }
  ]
}
```

### **7. Test Duplicate Application (Should Fail)**
```bash
# Run the same bid application twice
curl -X POST http://192.168.0.106:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "bid_id": "78cd3b82-6d42-41d5-b932-7a38826ba88c",
    "proposed_amount": 2500,
    "message": "Bid amount: ₹2500"
  }'
```

**Expected Response (400)**:
```json
{
  "success": false,
  "message": "You have already applied to this bid"
}
```

## 🔧 Frontend Testing

### **JavaScript/React Native Test**
```javascript
// Test bid application
const testBidApplication = async () => {
  try {
    const response = await fetch('http://192.168.0.106:3000/api/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        bid_id: "78cd3b82-6d42-41d5-b932-7a38826ba88c",
        proposed_amount: 2500,
        message: "Bid amount: ₹2500"
      })
    });

    const data = await response.json();
    console.log('Response:', data);

    if (response.ok) {
      console.log('✅ Bid application successful!');
    } else {
      console.log('❌ Bid application failed:', data);
    }
  } catch (error) {
    console.error('❌ Network error:', error);
  }
};

// Test campaign application
const testCampaignApplication = async () => {
  try {
    const response = await fetch('http://192.168.0.106:3000/api/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        campaign_id: "campaign-uuid-here",
        message: "I am interested in this campaign"
      })
    });

    const data = await response.json();
    console.log('Response:', data);

    if (response.ok) {
      console.log('✅ Campaign application successful!');
    } else {
      console.log('❌ Campaign application failed:', data);
    }
  } catch (error) {
    console.error('❌ Network error:', error);
  }
};
```

## 📋 Testing Checklist

- [ ] **Bid Application**: Works with `bid_id`, `proposed_amount`, and `message`
- [ ] **Campaign Application**: Works with `campaign_id` and `message`
- [ ] **Validation**: Rejects requests without either ID
- [ ] **Validation**: Rejects requests with both IDs
- [ ] **Validation**: Rejects invalid UUIDs
- [ ] **Validation**: Rejects negative proposed amounts
- [ ] **Duplicate Prevention**: Prevents duplicate applications
- [ ] **Database Storage**: Stores all fields correctly
- [ ] **Conversation Creation**: Creates conversation automatically
- [ ] **Real-time Updates**: Emits WebSocket events

## 🎯 Success Criteria

After running these tests:

1. ✅ **Bid applications work** without 400 errors
2. ✅ **Campaign applications work** without 400 errors
3. ✅ **Proper validation** with clear error messages
4. ✅ **Database stores** all required information
5. ✅ **Conversations are created** automatically
6. ✅ **Frontend integration** works seamlessly

## 🚀 Next Steps

1. **Run Database Migration**: Execute `database/complete_request_fields_migration.sql`
2. **Deploy Backend**: Push the updated code
3. **Run Tests**: Use the curl commands above
4. **Test Frontend**: Verify the app works without changes
5. **Monitor**: Check for any remaining issues

The 400 error should be completely resolved! 🎉
