# 🚀 Stoory Backend API Documentation

## Base URL
```
https://your-domain.com/api
```

## Authentication
All API requests require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

---

## 🔐 Authentication APIs

### 1. Send OTP
```http
POST /auth/send-otp
Content-Type: application/json

{
  "phone": "+1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent successfully"
}
```

### 2. Verify OTP
```http
POST /auth/verify-otp
Content-Type: application/json

{
  "phone": "+1234567890",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "token": "jwt_token_here",
  "user": {
    "id": "uuid",
    "phone": "+1234567890",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "influencer",
    "gender": "male",
    "languages": ["English", "Spanish"],
    "categories": ["Fashion", "Lifestyle"],
    "min_range": 1000,
    "max_range": 5000
  }
}
```

---

## 👤 User Management APIs

### 3. Get User Profile
```http
GET /users/profile
Authorization: Bearer <token>
```

### 4. Update User Profile
```http
PUT /users/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "gender": "male",
  "languages": ["English", "Spanish"],
  "categories": ["Fashion", "Lifestyle"],
  "min_range": 1000,
  "max_range": 5000
}
```

### 5. Get Social Platforms
```http
GET /users/social-platforms
Authorization: Bearer <token>
```

### 6. Add Social Platform
```http
POST /users/social-platforms
Authorization: Bearer <token>
Content-Type: application/json

{
  "platform_name": "Instagram",
  "profile_link": "https://instagram.com/johndoe",
  "followers_count": 10000,
  "engagement_rate": 3.5
}
```

---

## 📢 Campaign APIs

### 7. Create Campaign
```http
POST /campaigns
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Summer Fashion Campaign",
  "description": "Promote our summer collection",
  "budget": 5000,
  "start_date": "2024-06-01",
  "end_date": "2024-08-31",
  "requirements": "Fashion content creators",
  "deliverables": ["Instagram Post", "Story"],
  "campaign_type": "product",
  "image_url": "https://example.com/image.jpg",
  "language": "English",
  "platform": "Instagram",
  "content_type": "Photo",
  "sending_package": true,
  "no_of_packages": 2
}
```

### 8. Get All Campaigns
```http
GET /campaigns?page=1&limit=10&status=open
Authorization: Bearer <token>
```

### 9. Get Campaign Details
```http
GET /campaigns/:id
Authorization: Bearer <token>
```

### 10. Update Campaign
```http
PUT /campaigns/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Updated Campaign Title",
  "budget": 6000
}
```

### 11. Delete Campaign
```http
DELETE /campaigns/:id
Authorization: Bearer <token>
```

### 12. Get Campaign Influencers
```http
GET /campaigns/:id/influencers
Authorization: Bearer <token>
```

---

## 💰 Bid APIs

### 13. Create Bid
```http
POST /bids
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Product Review Needed",
  "description": "Looking for product reviewers",
  "min_budget": 500,
  "max_budget": 2000,
  "requirements": "Honest reviews",
  "language": "English",
  "platform": "YouTube",
  "content_type": "Video",
  "category": "Tech",
  "expiry_date": "2024-12-31T23:59:59Z"
}
```

### 14. Get All Bids
```http
GET /bids?page=1&limit=10&status=open
Authorization: Bearer <token>
```

### 15. Get Bid Details
```http
GET /bids/:id
Authorization: Bearer <token>
```

### 16. Update Bid
```http
PUT /bids/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Updated Bid Title",
  "max_budget": 2500
}
```

### 17. Delete Bid
```http
DELETE /bids/:id
Authorization: Bearer <token>
```

### 18. Get Bid Influencers
```http
GET /bids/:id/influencers
Authorization: Bearer <token>
```

---

## 🤝 Request APIs

### 19. Apply to Campaign or Bid
```http
POST /requests
Authorization: Bearer <token>
Content-Type: application/json

// For Campaigns:
{
  "campaign_id": "campaign-uuid-here",
  "message": "I'm interested in this campaign"
}

// For Bids:
{
  "bid_id": "bid-uuid-here",
  "proposed_amount": 2500,
  "message": "Bid amount: ₹2500"
}
```

**Validation Rules:**
- Either `campaign_id` OR `bid_id` is required (not both)
- `proposed_amount` is required for bid applications
- `message` is optional but recommended
- `proposed_amount` must be a positive number
- `message` must be between 1 and 1000 characters

### 20. Get User Requests
```http
GET /requests?page=1&limit=10&status=connected
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "requests": [
    {
      "id": "request-uuid",
      "campaign_id": "campaign-uuid", // or null
      "bid_id": "bid-uuid", // or null
      "influencer_id": "influencer-uuid",
      "status": "connected",
      "proposed_amount": 2500, // for bids only
      "message": "I'm interested in this campaign",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "pages": 3
  }
}
```

### 21. Get Request Details
```http
GET /requests/:id
Authorization: Bearer <token>
```

### 22. Update Agreed Amount
```http
PUT /requests/:id/agree-amount
Authorization: Bearer <token>
Content-Type: application/json

{
  "final_agreed_amount": 1500
}
```

### 23. Withdraw Request
```http
DELETE /requests/:id
Authorization: Bearer <token>
```

### 24. Submit Work
```http
PUT /requests/:id/submit-work
Authorization: Bearer <token>
Content-Type: application/json

{
  "work_submission_link": "https://example.com/work",
  "work_description": "Completed the campaign requirements",
  "work_files": ["https://example.com/file1.jpg"]
}
```

### 25. Approve Work
```http
PUT /requests/:id/approve-work
Authorization: Bearer <token>
```

---

## 💬 Conversation APIs

### 27. Get Conversations
```http
GET /conversations?page=1&limit=10
Authorization: Bearer <token>
```

### 28. Get Conversation Messages
```http
GET /conversations/:id/messages?page=1&limit=50
Authorization: Bearer <token>
```

### 29. Send Message
```http
POST /conversations/:id/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Hello! I'm interested in your campaign",
  "media_url": "https://example.com/media.jpg"
}
```

### 30. Mark Messages as Seen
```http
PUT /conversations/:id/messages/seen
Authorization: Bearer <token>
```

---

## 💳 Payment & Wallet APIs

### 31. Get Wallet Balance
```http
GET /payments/wallet
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "balance": 1500.00,
  "frozen_balance": 500.00,
  "total_balance": 2000.00
}
```

### 32. Get Transaction History
```http
GET /payments/transactions?page=1&limit=10&status=completed
Authorization: Bearer <token>
```

### 33. Get Payment Statistics
```http
GET /payments/stats
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalEarnings": 5000.00,
    "totalSpent": 2000.00,
    "completedTransactions": 15,
    "pendingTransactions": 3,
    "failedTransactions": 1
  }
}
```

### 34. Process Payment Response
```http
POST /payments/process
Authorization: Bearer <token>
Content-Type: application/json

{
  "razorpay_order_id": "order_123",
  "razorpay_payment_id": "pay_456",
  "razorpay_signature": "signature_here",
  "request_id": "request_uuid",
  "amount": 1500
}
```

### 35. Manual Payment Control (Admin)
```http
POST /payments/freeze/:request_id
Authorization: Bearer <admin_token>
```

```http
POST /payments/release/:request_id
Authorization: Bearer <admin_token>
```

```http
POST /payments/complete/:request_id
Authorization: Bearer <admin_token>
```

---

## 📊 Analytics APIs

### 36. Get Request Summary
```http
GET /analytics/requests?source_type=campaign&payment_status=frozen
Authorization: Bearer <token>
```

### 37. Get Payment Tracking
```http
GET /analytics/payments?status=frozen
Authorization: Bearer <token>
```

---

## 🔧 Utility APIs

### 38. Upload Image
```http
POST /utils/upload-image
Authorization: Bearer <token>
Content-Type: multipart/form-data

{
  "file": <image_file>
}
```

### 39. Send WhatsApp Message
```http
POST /utils/send-whatsapp
Authorization: Bearer <token>
Content-Type: application/json

{
  "phone": "+1234567890",
  "message": "Your OTP is: 123456"
}
```

---

## 📋 Response Formats

### Success Response
```json
{
  "success": true,
  "data": {...},
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Paginated Response
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "pages": 10
  }
}
```

---

## 🔒 Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Invalid or missing token |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `VALIDATION_ERROR` | Invalid input data |
| `INSUFFICIENT_BALANCE` | Not enough wallet balance |
| `PAYMENT_ALREADY_PROCESSED` | Payment already handled |
| `REQUEST_NOT_FOUND` | Request doesn't exist |
| `INVALID_STATUS` | Invalid status transition |

---

## 🚀 WebSocket Events

### Connection
```javascript
const socket = io('https://your-domain.com');

// Join user room
socket.emit('join', { userId: 'user_uuid' });
```

### Events

#### New Message
```javascript
socket.on('new_message', (data) => {
  console.log('New message:', data);
});
```

#### Request Status Update
```javascript
socket.on('request_status_update', (data) => {
  console.log('Request status changed:', data);
});
```

#### Payment Status Update
```javascript
socket.on('payment_status_update', (data) => {
  console.log('Payment status changed:', data);
});
```

---

## 📝 Notes

1. **Authentication**: All endpoints require valid JWT token except `/auth/send-otp` and `/auth/verify-otp`
2. **Pagination**: Use `page` and `limit` query parameters for paginated endpoints
3. **File Uploads**: Use `multipart/form-data` for file uploads
4. **WebSocket**: Real-time updates for messages and status changes
5. **Payment Flow**: Automatic freezing/release via database triggers
6. **Error Handling**: Always check `success` field in responses

---

## 🧪 Testing

### Test Payment Flow
```bash
# 1. Create test request
curl -X POST /requests/campaign/test-campaign-id \
  -H "Authorization: Bearer <token>"

# 2. Set agreed amount
curl -X PUT /requests/test-request-id/agree-amount \
  -H "Authorization: Bearer <token>" \
  -d '{"final_agreed_amount": 500}'

# 3. Process payment (status becomes 'paid')
curl -X POST /payments/process \
  -H "Authorization: Bearer <token>" \
  -d '{"request_id": "test-request-id", "amount": 500}'

# 4. Complete work (status becomes 'completed')
curl -X PUT /requests/test-request-id/approve-work \
  -H "Authorization: Bearer <token>"
```

The API is now ready for production use! 🎉
