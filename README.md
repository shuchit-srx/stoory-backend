# Stoory Backend

A comprehensive backend for the Stoory platform - connecting Brand Owners with Influencers through campaigns and bids.

## 🚀 Features

- **Authentication**: Supabase OTP-based phone authentication with built-in JWT tokens
- **Role-based Access**: Influencers, Brand Owners, and Admin roles
- **Campaign Management**: Create and manage campaigns/bids
- **Real-time Messaging**: Socket.IO powered chat system
- **Transaction Management**: Process payment responses from frontend
- **Wallet System**: Two-stage payment system
- **Row Level Security**: Comprehensive data protection
- **File Storage**: Supabase Storage integration

## 🏗️ Architecture

```
backend/
├── controllers/          # Business logic controllers
├── routes/              # API route definitions
├── middleware/          # Security and validation middleware
├── utils/               # Utility functions (auth, payment)
├── sockets/             # Socket.IO message handling
├── supabase/            # Supabase client configuration
├── database/            # Database schema and migrations
├── index.js             # Main server file
└── package.json         # Dependencies
```

## 📋 Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Supabase account and project

## 🛠️ Setup Instructions

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd stoory-backend
npm install
```

### 2. Environment Configuration

Copy the environment template and configure your variables:

```bash
cp env.example .env
```

Update `.env` with your configuration:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Supabase Configuration
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# File Upload Configuration
MAX_FILE_SIZE=5242880
ALLOWED_FILE_TYPES=image/jpeg,image/png,image/gif,video/mp4,video/avi

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS Configuration
CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# Database Configuration
DB_POOL_SIZE=10
DB_IDLE_TIMEOUT=30000
```

### 3. Database Setup

1. Create a new Supabase project
2. Run the database schema from `database/schema.sql`
3. Configure Row Level Security (RLS) policies
4. Set up Supabase Storage buckets for file uploads

### 4. Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:3000`

## 📚 API Documentation

### Authentication

#### Send OTP
```http
POST /api/auth/send-otp
Content-Type: application/json

{
  "phone": "+1234567890"
}
```

#### Verify OTP
```http
POST /api/auth/verify-otp
Content-Type: application/json

{
  "phone": "+1234567890",
  "token": "123456",
  "userData": {
    "email": "user@example.com",
    "role": "influencer"
  }
}
```

**Response includes Supabase session:**
```json
{
  "success": true,
  "user": { ... },
  "session": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "expires_at": 1234567890
  },
  "message": "Authentication successful"
}
```

#### Refresh Token
```http
POST /api/auth/refresh-token
Content-Type: application/json

{
  "refresh_token": "eyJ..."
}
```

### Campaigns

#### Create Campaign
```http
POST /api/campaigns
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
  "type": "campaign",
  "title": "Summer Product Launch",
  "description": "Promote our new summer collection",
  "budget": 5000,
  "start_date": "2024-06-01",
  "end_date": "2024-08-31"
}
```

#### Get Campaigns
```http
GET /api/campaigns?page=1&limit=10&type=campaign&status=pending
Authorization: Bearer <supabase_access_token>
```

### Bids

#### Create Bid
```http
POST /api/bids
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
  "title": "Quick Video Promotion",
  "description": "Looking for influencers to promote our new product",
  "min_budget": 5000,
  "max_budget": 25000,
  "requirements": "General audience, 18-35 age group",
  "language": "English",
  "platform": "Instagram",
  "content_type": "Video",
  "category": "Fashion",
  "expiry_date": "2025-09-30T23:59:59Z"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Quick Video Promotion",
    "description": "Looking for influencers to promote our new product",
    "min_budget": 5000,
    "max_budget": 25000,
    "requirements": "General audience, 18-35 age group",
    "language": "English",
    "platform": "Instagram",
    "content_type": "Video",
    "category": "Fashion",
    "expiry_date": "2025-09-30T23:59:59Z",
    "status": "open",
    "created_at": "2025-08-12T10:30:00Z",
    "updated_at": "2025-08-12T10:30:00Z"
  },
  "message": "Bid created successfully"
}
```

#### Get Bids
```http
GET /api/bids?page=1&limit=10&status=open&min_budget=1000&max_budget=50000&search=video
Authorization: Bearer <supabase_access_token>
```

#### Update Bid
```http
PUT /api/bids/:id
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
  "title": "Updated Video Promotion",
  "max_budget": 30000,
  "expiry_date": "2025-10-15T23:59:59Z"
}
```

#### Delete Bid
```http
DELETE /api/bids/:id
Authorization: Bearer <supabase_access_token>
```

#### Get Bid Statistics
```http
GET /api/bids/stats
Authorization: Bearer <supabase_access_token>
```

### Requests

#### Apply to Campaign
```http
POST /api/requests
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
  "campaign_id": "uuid-here"
}
```

### Messaging

#### Get Conversations
```http
GET /api/messages/conversations?page=1&limit=10
Authorization: Bearer <supabase_access_token>
```

#### Send Message
```http
POST /api/messages/conversations/:conversation_id/messages
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
  "message": "Hello! I'm interested in your campaign",
  "media_url": "https://example.com/image.jpg"
}
```

### Transactions

#### Process Payment Response
```http
POST /api/payments/process-payment
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
  "razorpay_order_id": "order_xxx",
  "razorpay_payment_id": "pay_xxx",
  "razorpay_signature": "signature_xxx",
  "request_id": "uuid-here",
  "amount": 2500,
  "payment_type": "approval"
}
```

#### Get Wallet Balance
```http
GET /api/payments/wallet/balance
Authorization: Bearer <supabase_access_token>
```

#### Get Transaction History
```http
GET /api/payments/transactions?page=1&limit=10&status=completed
Authorization: Bearer <supabase_access_token>
```

#### Get Request Payment Details
```http
GET /api/payments/request/:request_id/payment-details
Authorization: Bearer <supabase_access_token>
```

## 🔐 Supabase Authentication

### Token Management

The backend uses Supabase's built-in JWT tokens:

- **Access Token**: Used for API authentication (short-lived)
- **Refresh Token**: Used to get new access tokens (long-lived)
- **Automatic Refresh**: Supabase handles token refresh automatically

### Frontend Integration

```javascript
// Frontend - Initialize Supabase client
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
)

// Send OTP
const sendOTP = async (phone) => {
  const { data, error } = await supabase.auth.signInWithOtp({
    phone: phone
  })
  return { data, error }
}

// Verify OTP
const verifyOTP = async (phone, token) => {
  const { data, error } = await supabase.auth.verifyOtp({
    phone: phone,
    token: token,
    type: 'sms'
  })
  return { data, error }
}

// Use access token for API calls
const makeAPICall = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  
  const response = await fetch('/api/campaigns', {
    headers: {
      'Authorization': `Bearer ${session.access_token}`
    }
  })
}
```

## 💳 Frontend Payment Integration

### 1. Install Razorpay SDK

```bash
npm install razorpay
```

### 2. Initialize Razorpay

```javascript
// Frontend code
const options = {
  key: process.env.REACT_APP_RAZORPAY_KEY_ID,
  currency: "INR",
  name: "Stoory",
  description: "Campaign Payment",
  amount: amount * 100, // Convert to paise
  handler: function (response) {
    // Send payment response to backend
    processPaymentResponse(response);
  },
  prefill: {
    name: user.name,
    email: user.email,
    contact: user.phone
  },
  theme: {
    color: "#3399cc"
  }
};

const rzp = new window.Razorpay(options);
rzp.open();
```

### 3. Payment Flow

1. **Frontend**: Create Razorpay payment
2. **Frontend**: User completes payment
3. **Frontend**: Send payment response to backend
4. **Backend**: Process and store transaction
5. **Backend**: Update campaign/request status

### 4. Send Payment Response to Backend

```javascript
// Frontend - Send payment response to backend
const processPaymentResponse = async (paymentResponse) => {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    
    const response = await fetch('/api/payments/process-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        razorpay_order_id: paymentResponse.razorpay_order_id,
        razorpay_payment_id: paymentResponse.razorpay_payment_id,
        razorpay_signature: paymentResponse.razorpay_signature,
        request_id: requestId,
        amount: amount,
        payment_type: paymentType // 'approval' or 'completion'
      })
    });
    
    const result = await response.json();
    if (result.success) {
      console.log('Payment processed successfully');
      // Update UI accordingly
    }
  } catch (error) {
    console.error('Payment processing failed:', error);
  }
};
```

## 🔌 Socket.IO Events

### Client to Server

- `join` - Join user room
- `join_conversation` - Join conversation room
- `leave_conversation` - Leave conversation room
- `typing_start` - Start typing indicator
- `typing_stop` - Stop typing indicator
- `send_message` - Send a message
- `mark_seen` - Mark message as seen

### Server to Client

- `new_message` - New message received
- `user_typing` - User typing indicator
- `message_seen` - Message seen status
- `message_notification` - Message notification
- `user_status_change` - User status change
- `user_offline` - User went offline

## 🔒 Security Features

- **Row Level Security (RLS)**: Database-level access control
- **Supabase Authentication**: Built-in JWT token management
- **Rate Limiting**: Protection against abuse
- **CORS Configuration**: Cross-origin request control
- **Input Validation**: Comprehensive request validation
- **SQL Injection Protection**: Parameterized queries
- **XSS Protection**: Security headers

## 💳 Payment Flow

1. **Campaign/Bid Creation**: Brand Owner creates campaign or bid
2. **Application**: Influencer applies to campaign or bid
3. **Approval Payment**: 
   - Frontend creates Razorpay payment
   - User completes payment
   - Frontend sends payment response to backend
   - Backend processes transaction and updates status
4. **Work Phase**: Influencer completes the work
5. **Completion Payment**: 
   - Same process as approval payment
   - Backend updates request status to completed
6. **Campaign/Bid Closure**: Campaign or bid marked as closed

## 🗄️ Database Schema

### Core Tables

- `users` - User profiles and authentication
- `campaigns` - Detailed campaigns with requirements and deliverables
- `bids` - Simple bids for quick transactions
- `requests` - Influencer applications (unified for both campaigns and bids)
- `conversations` - Chat conversations
- `messages` - Individual messages
- `wallets` - User wallet balances
- `transactions` - Payment transaction history
- `social_platforms` - User social media profiles

## 🚀 Deployment

### Environment Variables

Ensure all environment variables are set in your production environment:

```bash
# Required for production
NODE_ENV=production
PORT=3000
SUPABASE_URL=your_production_supabase_url
SUPABASE_ANON_KEY=your_production_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_production_service_key
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

For support and questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

---

**Stoory Backend** - Connecting Brands with Influencers 🚀 