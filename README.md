# 🚀 Stoory Backend - Influencer Marketing Platform

## 📋 Overview

This is the backend for the Stoory platform, a comprehensive influencer marketing platform that connects brand owners with influencers through automated workflows, real-time messaging, and secure payment processing.

## ✨ **Key Features**

- 🔄 **Automated Workflows** - Structured conversation flows for campaign management
- 🎯 **Role-Based Access** - Different capabilities for admins, brand owners, and influencers
- 💬 **Real-time Messaging** - WebSocket-based chat system with file attachments
- 💰 **Payment Integration** - Razorpay integration with escrow and wallet management
- 🔒 **Secure Authentication** - JWT-based authentication with role-based authorization
- 📱 **Push Notifications** - FCM integration for real-time updates
- 🗄️ **Database Persistence** - PostgreSQL with Supabase for data management
- 📊 **Analytics & Reporting** - Comprehensive tracking and reporting capabilities

## 🏗️ **Architecture**


```
Frontend (React/React Native) 
    ↓
Backend (Node.js/Express)
    ↓
Database (Supabase/PostgreSQL)
    ↓
External APIs (Razorpay, FCM, WhatsApp)
```

## 📚 **API Documentation**

### **Comprehensive API Guides:**
- 📖 **[Admin Panel API Documentation](ADMIN_PANEL_API_DOCUMENTATION.md)** - Complete admin panel API reference
- 👥 **[Influencer API Documentation](INFLUENCER_API_DOCUMENTATION.md)** - All APIs for influencers
- 🏢 **[Brand Owner API Documentation](BRAND_OWNER_API_DOCUMENTATION.md)** - All APIs for brand owners

### **For Developers:**
- 🔧 **API Routes** - Located in `/routes/` directory
- 🎮 **Controllers** - Business logic in `/controllers/` directory
- 🗄️ **Database Schema** - SQL files in `/database/` directory
- ⚙️ **Utilities** - Helper functions in `/utils/` directory

## 🚀 **Quick Start**

### **1. Environment Setup**
```bash
# Copy environment file
cp env.example .env

# Fill in your configuration
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
JWT_SECRET=your_jwt_secret
SYSTEM_USER_ID=00000000-0000-0000-0000-000000000000
```

### **2. Install Dependencies**
```bash
npm install
```

### **3. Database Setup**
```bash
# Apply schema updates (if needed)
# The database schema is already set up for automated chat
```

### **4. Start Server**
```bash
npm start
# or
node index.js
```

## 🔌 **API Endpoints Overview**

### **Authentication & Authorization**
- `POST /api/auth/send-otp` - Send OTP for login
- `POST /api/auth/verify-otp` - Verify OTP and get tokens
- `POST /api/auth/refresh-token` - Refresh access token
- `GET /api/auth/profile` - Get user profile

### **User Management**
- `GET /api/users/influencers` - List influencers (brand owners & admins)
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/verification-details` - Update verification details

### **Campaign Management**
- `POST /api/campaigns` - Create campaign (brand owners & admins)
- `GET /api/campaigns` - List campaigns
- `GET /api/campaigns/stats` - Get campaign statistics
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign

### **Bid Management**
- `POST /api/bids` - Create bid (brand owners & admins)
- `GET /api/bids` - List bids
- `GET /api/bids/stats` - Get bid statistics
- `PUT /api/bids/:id` - Update bid
- `DELETE /api/bids/:id` - Delete bid

### **Request Management**
- `POST /api/requests` - Create request (influencers)
- `GET /api/requests` - List requests
- `PUT /api/requests/:id/status` - Update request status
- `POST /api/requests/approval-payment` - Process approval payment

### **Payment & Wallet**
- `GET /api/payments/transactions` - Get transaction history
- `GET /api/payments/wallet/balance` - Get wallet balance
- `POST /api/payments/wallet/withdraw` - Withdraw from wallet
- `POST /api/payments/process-payment` - Process payment

### **Messaging & Conversations**
- `GET /api/messages/conversations` - List conversations
- `POST /api/messages/conversations/:id/messages` - Send message
- `GET /api/messages/unread-count` - Get unread count

### **Admin Panel (Admin Only)**
- `GET /api/coupons/admin/all` - Get all coupons
- `POST /api/coupons/admin/create` - Create coupon
- `GET /api/fcm/cleanup` - Cleanup inactive tokens

## 🎯 **User Roles & Capabilities**

### **Admin**
- Full access to all endpoints
- User management and verification
- Campaign and bid oversight
- Payment and transaction management
- System monitoring and analytics

### **Brand Owner**
- Create and manage campaigns/bids
- Discover and connect with influencers
- Process payments and manage requests
- Review and approve work submissions
- Access to premium features with subscription

### **Influencer**
- Discover available campaigns/bids
- Submit requests and proposals
- Manage work submissions
- Receive payments and manage wallet
- Update profile and social platforms

## 🔧 **Key Components**

### **Controllers**
- **Auth Controller** - Authentication and user management
- **User Controller** - Profile and verification management
- **Campaign Controller** - Campaign creation and management
- **Bid Controller** - Bid creation and management
- **Request Controller** - Request processing and work management
- **Payment Controller** - Payment processing and wallet management
- **Message Controller** - Real-time messaging and conversations
- **Coupon Controller** - Coupon management and validation
- **FCM Controller** - Push notification management

### **Services**
- **FCM Service** - Push notification handling
- **Escrow Service** - Payment escrow management
- **State Machine Service** - Workflow state management

### **Utilities**
- **Automated Flow Service** - Automated conversation workflows
- **Enhanced Balance Service** - Advanced wallet management
- **Image Upload Service** - File upload and storage
- **Payment Service** - Razorpay integration

### **Database Schema**
- **Users** - User profiles, roles, and verification
- **Campaigns** - Marketing campaigns and requirements
- **Bids** - Project bids and specifications
- **Requests** - Influencer applications and work submissions
- **Conversations** - Chat conversations and flow states
- **Messages** - Real-time messages and attachments
- **Transactions** - Payment and wallet transactions
- **Subscriptions** - User subscription management

## 🚨 **Important Notes**

### **Admin Setup**
- Default admin user: Phone `+919999999999`, OTP `123456`
- Run `database/seed_admin_user.sql` to create admin user
- Admin has full access to all endpoints and data

### **Authentication**
- JWT-based authentication with role-based authorization
- Access tokens expire in 15 minutes, refresh tokens last longer
- All protected endpoints require `Authorization: Bearer <token>` header

### **Payment Integration**
- Razorpay integration for payment processing
- Escrow system for secure fund holding
- Wallet system for influencer earnings management

### **Real-time Features**
- WebSocket support for live messaging
- FCM push notifications for mobile apps
- Real-time conversation updates

## 🧪 **Testing**

### **API Testing**
```bash
# Test health endpoint
curl http://localhost:3000/health

# Test admin login
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999999","otp":"123456"}'

# Test campaign creation (requires auth token)
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"title":"Test Campaign","description":"Test Description","budget":5000}'
```

### **Database Testing**
```bash
# Check if admin user exists
# Verify user roles and permissions
# Test campaign and bid creation
```

## 🐛 **Troubleshooting**

### **Common Issues**

1. **"API route not found"**
   - Use correct endpoints from the API documentation
   - Check route definitions in `/routes/` directory

2. **"Unauthorized" errors**
   - Verify JWT token is valid and not expired
   - Check if user has required role for the endpoint

3. **"Admin access denied"**
   - Ensure admin user is created in database
   - Run `database/seed_admin_user.sql` script

4. **Payment processing errors**
   - Check Razorpay configuration
   - Verify webhook endpoints are properly set up

### **Debug Commands**
```bash
# Check backend health
curl http://localhost:3000/health

# Test admin login
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999999","otp":"123456"}'

# Check database connection
# Use Supabase dashboard or CLI
```

## 📱 **Frontend Integration**

### **API Integration**
1. **Use correct API endpoints** (see comprehensive API documentation)
2. **Implement proper authentication** with JWT token management
3. **Handle role-based access** for different user types
4. **Implement real-time features** with WebSocket and FCM

### **Key Frontend Components**
- Authentication service with token management
- Role-based UI components
- Real-time messaging interface
- Payment integration components
- File upload and attachment handling

## 🤝 **Contributing**

1. **Follow the existing code structure**
2. **Add tests for new features**
3. **Update documentation** for API changes
4. **Use proper error handling** and logging

## 📄 **License**

This project is proprietary software. All rights reserved.

## 🆘 **Support**

For technical issues or questions:
1. Check the comprehensive API documentation
2. Review the role-specific API guides
3. Check backend logs for errors
4. Contact the backend development team

---

## 🎉 **Status: Production Ready**

The Stoory Backend is **fully implemented and production-ready**. The platform provides comprehensive APIs for admin panel management, influencer operations, and brand owner functionality. All major features are implemented including authentication, payment processing, real-time messaging, and automated workflows.

**Last Updated**: December 2024
**Version**: 2.0.0
**Status**: ✅ Production Ready 
