# 🚀 Stoory Backend

A comprehensive influencer marketing platform backend built with Node.js, Express, and Supabase.

## 🎯 Features

- **WhatsApp OTP Authentication** - Secure phone-based login
- **Single Payment System** - Simplified payment flow with escrow
- **Real-time Messaging** - WebSocket-based chat system
- **Automated Conversations** - AI-powered chat flow
- **Work Management** - Submission, approval, and revision system
- **Wallet System** - Balance and transaction management
- **File Upload** - Image and media handling
- **Social Platform Integration** - Influencer profile management

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Database      │
│   (React/Next)  │◄──►│   (Node.js)     │◄──►│   (Supabase)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   WebSocket     │
                       │   (Socket.io)   │
                       └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Supabase account
- Railway account (for deployment)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd stoory-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp env.example .env
```

Fill in your environment variables:
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
NODE_ENV=development
```

4. **Set up database**
   - Run `database/schema.sql` in your Supabase SQL Editor
   - Run `database/consolidated_migration.sql` for the latest features

5. **Start development server**
```bash
npm run dev
```

## 📚 Documentation

- **[API Documentation](API_DOCUMENTATION.md)** - Complete API reference with examples
- **[Project Structure](PROJECT_STRUCTURE.md)** - Detailed project overview
- **[Single Payment System](SINGLE_PAYMENT_SYSTEM_IMPLEMENTATION.md)** - Payment system guide

## 🔄 Payment Flow

### Single Payment System
1. **Negotiation** → Brand and influencer agree on `final_agreed_amount`
2. **Freeze** → When status becomes 'paid', entire amount frozen in escrow
3. **Work** → Influencer completes the work
4. **Release** → When status becomes 'completed', payment becomes withdrawable
5. **Withdrawal** → Influencer can withdraw the amount

## 🗄️ Database Schema

### Core Tables
- **`users`** - User profiles (brand owners, influencers, admins)
- **`campaigns`** - Brand campaigns with fixed budgets
- **`bids`** - Brand bids with min/max budgets
- **`requests`** - Connections between influencers and campaigns/bids
- **`conversations`** - Chat sessions between brand and influencer
- **`messages`** - Individual messages in conversations
- **`wallets`** - User wallet balances and frozen amounts
- **`transactions`** - All payment movements and history

## 🚀 Deployment

### Railway Deployment
1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push to main branch

### Manual Deployment
```bash
npm run build
npm start
```

## 🧪 Testing

### Test Payment Flow
```bash
# 1. Create test request
curl -X POST /api/requests/campaign/test-campaign-id \
  -H "Authorization: Bearer <token>"

# 2. Set agreed amount
curl -X PUT /api/requests/test-request-id/agree-amount \
  -H "Authorization: Bearer <token>" \
  -d '{"final_agreed_amount": 500}'

# 3. Process payment (status becomes 'paid')
curl -X POST /api/payments/process \
  -H "Authorization: Bearer <token>" \
  -d '{"request_id": "test-request-id", "amount": 500}'

# 4. Complete work (status becomes 'completed')
curl -X PUT /api/requests/test-request-id/approve-work \
  -H "Authorization: Bearer <token>"
```

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/send-otp` - Send WhatsApp OTP
- `POST /api/auth/verify-otp` - Verify OTP and get JWT token

### User Management
- `GET/PUT /api/users/profile` - Get/update user profile
- `GET/POST /api/users/social-platforms` - Manage social platforms

### Campaigns & Bids
- `POST/GET/PUT/DELETE /api/campaigns` - Campaign CRUD operations
- `POST/GET/PUT/DELETE /api/bids` - Bid CRUD operations

### Requests & Work
- `POST /api/requests/campaign/:id` - Apply to campaign
- `POST /api/requests/bid/:id` - Apply to bid
- `GET /api/requests` - Get user requests
- `PUT /api/requests/:id/agree-amount` - Set agreed amount

### Messaging
- `GET /api/conversations` - Get user conversations
- `GET /api/conversations/:id/messages` - Get conversation messages
- `POST /api/conversations/:id/messages` - Send message

### Payments & Wallet
- `GET /api/payments/wallet` - Get wallet balance
- `GET /api/payments/transactions` - Get transaction history
- `GET /api/payments/stats` - Get payment statistics

## 🛠️ Technology Stack

- **Backend**: Node.js + Express.js
- **Database**: PostgreSQL (Supabase)
- **Authentication**: JWT + WhatsApp OTP
- **Real-time**: Socket.io
- **File Storage**: Supabase Storage
- **Payment**: Razorpay integration
- **Deployment**: Railway
- **WhatsApp**: WhatsApp Business API

## 📁 Project Structure

```
stoory-backend/
├── 📁 controllers/           # API route handlers
├── 📁 database/              # Database migrations & schema
├── 📁 middleware/            # Express middleware
├── 📁 routes/               # API route definitions
├── 📁 sockets/              # WebSocket handlers
├── 📁 supabase/             # Database client
├── 📁 utils/                # Utility functions
├── 📄 index.js              # Main application entry point
└── 📄 package.json          # Dependencies & scripts
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support, email support@stoory.com or create an issue in this repository.

---

**Built with ❤️ for the influencer marketing community** 