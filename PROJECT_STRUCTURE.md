# 📁 Stoory Backend - Project Structure

## 🏗️ Directory Structure

```
stoory-backend/
├── 📁 controllers/           # API route handlers
│   ├── authController.js     # Authentication logic
│   ├── bidController.js      # Bid management
│   ├── campaignController.js # Campaign management
│   ├── messageController.js  # Messaging system
│   ├── paymentController.js  # Payment processing
│   ├── requestController.js  # Request management
│   ├── subscriptionController.js # Subscription handling
│   └── userController.js     # User management
│
├── 📁 database/              # Database migrations & schema
│   ├── schema.sql           # Main database schema
│   ├── consolidated_migration.sql # Single payment system migration
│   ├── add_escrow_and_revoke_system.sql # Escrow system
│   ├── subscription_system_migration.sql # Subscription features
│   └── storage_policies.sql # File storage policies
│
├── 📁 middleware/            # Express middleware
│   └── security.js          # Security & authentication
│
├── 📁 routes/               # API route definitions
│   ├── auth.js              # Authentication routes
│   ├── bids.js              # Bid routes
│   ├── campaigns.js         # Campaign routes
│   ├── messages.js          # Message routes
│   ├── payments.js          # Payment routes
│   ├── requests.js          # Request routes
│   ├── subscriptions.js     # Subscription routes
│   └── users.js             # User routes
│
├── 📁 sockets/              # WebSocket handlers
│   └── messageHandler.js    # Real-time messaging
│
├── 📁 supabase/             # Database client
│   └── client.js            # Supabase configuration
│
├── 📁 utils/                # Utility functions
│   ├── auth.js              # Authentication utilities
│   ├── automatedConversationHandler.js # Auto-chat system
│   ├── imageUpload.js       # Image upload handling
│   ├── payment.js           # Payment utilities
│   ├── supabaseStorageSetup.js # Storage configuration
│   └── whatsapp.js          # WhatsApp integration
│
├── 📄 index.js              # Main application entry point
├── 📄 package.json          # Dependencies & scripts
├── 📄 Dockerfile            # Docker configuration
├── 📄 railway.json          # Railway deployment config
├── 📄 nixpacks.toml         # Nixpacks configuration
├── 📄 env.example           # Environment variables template
└── 📄 README.md             # Project documentation
```

## 🗄️ Database Schema Overview

### Core Tables
- **`users`** - User profiles (brand owners, influencers, admins)
- **`campaigns`** - Brand campaigns with fixed budgets
- **`bids`** - Brand bids with min/max budgets
- **`requests`** - Connections between influencers and campaigns/bids
- **`conversations`** - Chat sessions between brand and influencer
- **`messages`** - Individual messages in conversations
- **`wallets`** - User wallet balances and frozen amounts
- **`transactions`** - All payment movements and history

### Supporting Tables
- **`otp_codes`** - WhatsApp OTP verification
- **`social_platforms`** - User social media profiles
- **`subscriptions`** - Subscription management

## 🔄 Payment Flow

### Single Payment System
1. **Negotiation** → Brand and influencer agree on `final_agreed_amount`
2. **Freeze** → When status becomes 'paid', entire amount frozen in escrow
3. **Work** → Influencer completes the work
4. **Release** → When status becomes 'completed', payment becomes withdrawable
5. **Withdrawal** → Influencer can withdraw the amount

### Database Functions
- `freeze_payment_for_request()` - Freezes payment in escrow
- `release_payment_to_influencer()` - Releases payment to influencer
- `mark_payment_completed()` - Marks payment as completed

## 🚀 API Structure

### Authentication
- `POST /auth/send-otp` - Send WhatsApp OTP
- `POST /auth/verify-otp` - Verify OTP and get JWT token

### User Management
- `GET/PUT /users/profile` - Get/update user profile
- `GET/POST /users/social-platforms` - Manage social platforms

### Campaigns & Bids
- `POST/GET/PUT/DELETE /campaigns` - Campaign CRUD operations
- `POST/GET/PUT/DELETE /bids` - Bid CRUD operations
- `GET /campaigns/:id/influencers` - Get campaign applicants
- `GET /bids/:id/influencers` - Get bid applicants

### Requests & Work
- `POST /requests/campaign/:id` - Apply to campaign
- `POST /requests/bid/:id` - Apply to bid
- `GET /requests` - Get user requests
- `PUT /requests/:id/agree-amount` - Set agreed amount
- `PUT /requests/:id/submit-work` - Submit completed work
- `PUT /requests/:id/approve-work` - Approve work

### Messaging
- `GET /conversations` - Get user conversations
- `GET /conversations/:id/messages` - Get conversation messages
- `POST /conversations/:id/messages` - Send message
- `PUT /conversations/:id/messages/seen` - Mark as seen

### Payments & Wallet
- `GET /payments/wallet` - Get wallet balance
- `GET /payments/transactions` - Get transaction history
- `GET /payments/stats` - Get payment statistics
- `POST /payments/process` - Process payment response

## 🔧 Key Features

### ✅ Implemented
- **WhatsApp OTP Authentication** - Secure phone-based login
- **Single Payment System** - Simplified payment flow with escrow
- **Real-time Messaging** - WebSocket-based chat system
- **Automated Conversations** - AI-powered chat flow
- **Work Management** - Submission, approval, and revision system
- **Wallet System** - Balance and transaction management
- **File Upload** - Image and media handling
- **Social Platform Integration** - Influencer profile management

### 🔄 Payment Status Flow
```
pending → frozen → withdrawable → completed
```

### 📊 Request Status Flow
```
connected → negotiating → paid → work_submitted → work_approved → completed
```

## 🛠️ Technology Stack

- **Backend**: Node.js + Express.js
- **Database**: PostgreSQL (Supabase)
- **Authentication**: JWT + WhatsApp OTP
- **Real-time**: Socket.io
- **File Storage**: Supabase Storage
- **Payment**: Razorpay integration
- **Deployment**: Railway
- **WhatsApp**: WhatsApp Business API

## 📋 Environment Variables

```env
# Database
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# JWT
JWT_SECRET=your_jwt_secret

# WhatsApp
WHATSAPP_API_KEY=your_whatsapp_api_key
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id

# Razorpay
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret

# Server
PORT=3000
NODE_ENV=production
```

## 🚀 Deployment

### Railway Deployment
1. Connect GitHub repository to Railway
2. Set environment variables
3. Deploy automatically on push

### Local Development
```bash
npm install
cp env.example .env
# Fill in environment variables
npm run dev
```

## 📚 Documentation Files

- **`API_DOCUMENTATION.md`** - Complete API reference
- **`SINGLE_PAYMENT_SYSTEM_IMPLEMENTATION.md`** - Payment system guide
- **`PROJECT_STRUCTURE.md`** - This file
- **`README.md`** - Main project documentation

## 🎯 Next Steps

1. **Run Database Migration** - Execute `consolidated_migration.sql`
2. **Deploy Backend** - Push to Railway
3. **Test APIs** - Use the provided API documentation
4. **Frontend Integration** - Connect frontend to these APIs
5. **Monitor & Optimize** - Track performance and usage

The backend is now clean, organized, and ready for production! 🎉
