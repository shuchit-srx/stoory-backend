# Admin Panel API Documentation

This comprehensive guide covers all available API endpoints for the Stoory Backend application that can be used by the admin panel.

## Table of Contents
1. [Quick Start - Admin Setup](#quick-start---admin-setup)
2. [Authentication & Authorization](#authentication--authorization)
3. [User Management](#user-management)
4. [Campaign Management](#campaign-management)
5. [Bid Management](#bid-management)
6. [Request Management](#request-management)
7. [Payment & Wallet Management](#payment--wallet-management)
8. [Message & Conversation Management](#message--conversation-management)
9. [Subscription Management](#subscription-management)
10. [File & Attachment Management](#file--attachment-management)
11. [Social Platform Management](#social-platform-management)
12. [Coupon Management](#coupon-management)
13. [FCM & Notifications](#fcm--notifications)
14. [System & Health Endpoints](#system--health-endpoints)

---

## Quick Start - Admin Setup

### 🚀 **Admin Login Credentials**
The system comes with a pre-configured admin user for testing:

- **Phone**: `+919999999999` or `9999999999`
- **OTP**: `123456`
- **Email**: `admin@stoory.com`
- **Role**: `admin`

### 🔑 **Admin Login**

Use the regular authentication flow - the system automatically recognizes admin role:

```bash
POST /api/auth/verify-otp
Content-Type: application/json

{
  "phone": "+919999999999",
  "otp": "123456"
}
```

**Response includes role information:**
```json
{
  "success": true,
  "user": {
    "id": "00000000-0000-0000-0000-000000000001",
    "name": "Admin User",
    "email": "admin@stoory.com",
    "phone": "+919999999999",
    "role": "admin"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**How it works:**
- Admin is just a regular user with `role: "admin"`
- JWT token contains the role information
- Middleware automatically grants admin permissions based on role
- No special admin endpoints needed - same authentication flow for all users

### 📊 **Admin Permissions**
As an admin, you have **FULL ACCESS** to all endpoints in the system:
- ✅ **User Management**: View, create, update, delete any user
- ✅ **Campaign Management**: Full CRUD operations on all campaigns
- ✅ **Bid Management**: Full CRUD operations on all bids
- ✅ **Request Management**: Process all requests and payments
- ✅ **Payment Management**: Access all transactions and wallets
- ✅ **Message Management**: View all conversations and messages
- ✅ **Subscription Management**: Manage all subscriptions
- ✅ **Coupon Management**: Full admin access to coupon system
- ✅ **System Management**: Health checks, monitoring, testing

### 🗄️ **Database Setup**
Run the admin seeding script to create the admin user:
```sql
\i database/seed_admin_user.sql
```

---

## Authentication & Authorization

### Base URL: `/api/auth`

#### Public Endpoints (No Authentication Required)

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/send-otp` | Send OTP for login | `{ "phone": "string" }` | `{ "success": boolean, "message": string }` |
| POST | `/send-registration-otp` | Send OTP for registration | `{ "phone": "string" }` | `{ "success": boolean, "message": string }` |
| POST | `/verify-otp` | Verify OTP and get tokens | `{ "phone": "string", "otp": "string" }` | `{ "success": boolean, "tokens": object, "user": object }` |
| POST | `/refresh-token` | Refresh access token | `{ "refresh_token": "string" }` | `{ "success": boolean, "tokens": object }` |
| GET | `/whatsapp-status` | Get WhatsApp service status | - | `{ "success": boolean, "whatsapp": object }` |
| GET | `/mock-login-info` | Get mock login info for testing | - | `{ "success": boolean, "data": object }` |

#### Protected Endpoints (Authentication Required)

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/profile` | Get user profile | - | `{ "success": boolean, "user": object }` |
| PUT | `/profile` | Update user profile | `{ "name": "string", "email": "string", ... }` | `{ "success": boolean, "user": object }` |
| POST | `/profile/image` | Upload profile image | FormData with `image` file | `{ "success": boolean, "image_url": string }` |
| DELETE | `/profile/image` | Delete profile image | - | `{ "success": boolean }` |
| POST | `/profile/verification-document` | Upload verification document | FormData with `verification_document` file | `{ "success": boolean, "document_url": string }` |
| POST | `/logout` | Logout user | - | `{ "success": boolean }` |
| DELETE | `/account` | Delete user account | - | `{ "success": boolean }` |

#### Social Platform Management (Under Auth)

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/social-platforms` | Get user's social platforms | - | `{ "success": boolean, "platforms": array }` |
| POST | `/social-platforms` | Add social platform | `{ "platform": "string", "username": "string", "followers": number }` | `{ "success": boolean, "platform": object }` |
| PUT | `/social-platforms/:id` | Update social platform | `{ "platform": "string", "username": "string", "followers": number }` | `{ "success": boolean, "platform": object }` |
| DELETE | `/social-platforms/:id` | Delete social platform | - | `{ "success": boolean }` |
| GET | `/social-platforms/stats` | Get social platform statistics | - | `{ "success": boolean, "stats": object }` |

---

## User Management

### Base URL: `/api/users`

All endpoints require authentication and specific role permissions.

| Method | Endpoint | Description | Required Role | Request Body | Response |
|--------|----------|-------------|---------------|--------------|----------|
| GET | `/influencers` | List all influencers | `brand_owner`, `admin` | Query: `page`, `limit`, `search` | `{ "success": boolean, "influencers": array, "pagination": object }` |
| GET | `/brand-owners` | List all brand owners | `admin` | Query: `page`, `limit`, `search` | `{ "success": boolean, "brand_owners": array, "pagination": object }` |
| GET | `/stats` | Get user counts by role | `admin` | - | `{ "success": boolean, "stats": { "influencers": number, "brand_owners": number, "admins": number } }` |
| GET | `/profile` | Get user profile | Any authenticated user | - | `{ "success": boolean, "user": object }` |
| GET | `/verification-status` | Get user verification status | Any authenticated user | - | `{ "success": boolean, "verification": object }` |
| PUT | `/verification-details` | Update verification details | Any authenticated user | `{ "verification_details": object }` | `{ "success": boolean, "verification": object }` |
| POST | `/verification-document` | Upload verification document | Any authenticated user | FormData with `verification_document` file | `{ "success": boolean, "document_url": string }` |

### User Data Structure
```json
{
  "id": "string",
  "name": "string", 
  "role": "influencer" | "brand_owner" | "admin",
  "phone": "string",
  "email": "string",
  "gender": "string",
  "languages": "array",
  "categories": "array", 
  "min_range": "number",
  "max_range": "number",
  "profile_image_url": "string",
  "created_at": "string",
  "social_platforms": [
    {
      "id": "string",
      "platform_name": "string",
      "profile_link": "string", 
      "followers_count": "number",
      "engagement_rate": "number"
    }
  ]
}
```

### Admin-only extra fields (returned in listings and details)

- Influencers (only when requester is `admin`):
```json
{
  "bids_count": 0,
  "campaigns_count": 0
}
```

- Brand owners (only when requester is `admin`):
```json
{
  "created_bids_count": 0,
  "created_campaigns_count": 0,
  "requests_to_bids_count": 0,
  "requests_to_campaigns_count": 0
}
```

---

## Campaign Management

### Base URL: `/api/campaigns`

All endpoints require authentication. CRUD operations require `brand_owner` or `admin` role.

#### Campaign CRUD Operations

| Method | Endpoint | Description | Required Role | Request Body | Response |
|--------|----------|-------------|---------------|--------------|----------|
| POST | `/` | Create new campaign | `brand_owner`, `admin` | `{ "title": "string", "description": "string", "budget": number, "image": file }` | `{ "success": boolean, "campaign": object }` |
| GET | `/` | Get all campaigns | Any authenticated user | Query: `page`, `limit`, `status`, `search` | `{ "success": boolean, "campaigns": array, "pagination": object }` |
| GET | `/stats` | Get campaign statistics | Any authenticated user | - | `{ "success": boolean, "stats": object }` |
| GET | `/:id` | Get specific campaign | Any authenticated user | - | `{ "success": boolean, "campaign": object }` |
| PUT | `/:id` | Update campaign | `brand_owner`, `admin` | `{ "title": "string", "description": "string", "budget": number, "image": file }` | `{ "success": boolean, "campaign": object }` |
| DELETE | `/:id` | Delete campaign | `brand_owner`, `admin` | - | `{ "success": boolean }` |

### Campaign Data Structure
```json
{
  "id": "string",
  "title": "string",
  "description": "string", 
  "budget": "number",
  "status": "open" | "pending" | "closed",
  "start_date": "string",
  "end_date": "string",
  "requirements": "string",
  "deliverables": "array",
  "campaign_type": "product" | "service",
  "image_url": "string",
  "language": "string",
  "platform": "string",
  "content_type": "string",
  "sending_package": "boolean",
  "no_of_packages": "number",
  "created_by": "string",
  "created_at": "string",
  "updated_at": "string"
}
```

---

## Bid Management

### Base URL: `/api/bids`

All endpoints require authentication. CRUD operations require `brand_owner` or `admin` role.

#### Bid CRUD Operations

| Method | Endpoint | Description | Required Role | Request Body | Response |
|--------|----------|-------------|---------------|--------------|----------|
| POST | `/` | Create new bid | `brand_owner`, `admin` | `{ "title": "string", "description": "string", "budget": number, "image": file }` | `{ "success": boolean, "bid": object }` |
| GET | `/` | Get all bids | Any authenticated user | Query: `page`, `limit`, `status`, `search` | `{ "success": boolean, "bids": array, "pagination": object }` |
| GET | `/stats` | Get bid statistics | Any authenticated user | - | `{ "success": boolean, "stats": object }` |
| GET | `/:id` | Get specific bid | Any authenticated user | - | `{ "success": boolean, "bid": object }` |
| PUT | `/:id` | Update bid | `brand_owner`, `admin` | `{ "title": "string", "description": "string", "budget": number, "image": file }` | `{ "success": boolean, "bid": object }` |
| DELETE | `/:id` | Delete bid | `brand_owner`, `admin` | - | `{ "success": boolean }` |

### Bid Data Structure
```json
{
  "id": "string",
  "title": "string",
  "description": "string",
  "min_budget": "number",
  "max_budget": "number", 
  "requirements": "string",
  "language": "string",
  "platform": "string",
  "content_type": "string",
  "category": "string",
  "expiry_date": "string",
  "status": "open" | "pending" | "closed",
  "created_by": "string",
  "created_at": "string",
  "updated_at": "string"
}
```

---

## Request Management

### Base URL: `/api/requests`

All endpoints require authentication. Most operations require specific roles.

| Method | Endpoint | Description | Required Role | Request Body | Response |
|--------|----------|-------------|---------------|--------------|----------|
| POST | `/` | Create new request | `influencer` | `{ "bid_id": "string", "proposed_amount": number, "message": "string" }` | `{ "success": boolean, "request": object }` |
| GET | `/` | Get all requests | Any authenticated user | Query: `page`, `limit`, `status`, `user_id` | `{ "success": boolean, "requests": array, "pagination": object }` |
| GET | `/:id` | Get specific request | Any authenticated user | - | `{ "success": boolean, "request": object }` |
| PUT | `/:id/status` | Update request status | `brand_owner`, `admin` | `{ "status": "string" }` | `{ "success": boolean, "request": object }` |
| PUT | `/:id/agree` | Update agreed amount | `influencer` | `{ "agreed_amount": number }` | `{ "success": boolean, "request": object }` |
| DELETE | `/:id` | Withdraw request | `influencer` | - | `{ "success": boolean }` |

### Request Data Structure
```json
{
  "id": "string",
  "campaign_id": "string",
  "bid_id": "string", 
  "influencer_id": "string",
  "status": "connected" | "negotiating" | "paid" | "completed" | "cancelled",
  "final_agreed_amount": "number",
  "initial_payment": "number",
  "final_payment": "number",
  "created_at": "string",
  "updated_at": "string"
}
```

---

## Report Management

### Base URL: `/api/reports`

All endpoints require authentication.

#### User Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/` | Create a user report | `{ "reported_user_id": "string", "conversation_id": "string?", "reason_id": "string?", "reason_text": "string?" }` | `{ "success": boolean, "report": object }` |
| GET | `/mine` | Get my reports | Query: `page`, `limit` | `{ "success": boolean, "reports": array, "pagination": object }` |

#### Admin Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/` | List reports (filterable) | Query: `page`, `limit`, `status`, `reported_user_id` | `{ "success": boolean, "reports": array, "counts": array, "pagination": object }` |
| GET | `/reasons` | List report reasons | - | `{ "success": boolean, "reasons": array }` |
| POST | `/reasons` | Create report reason | `{ "title": "string", "description": "string?", "is_active": boolean, "position": number }` | `{ "success": boolean, "reason": object }` |
| PUT | `/reasons/:id` | Update report reason | `{ "title": "string?", "description": "string?", "is_active": boolean?, "position": number? }` | `{ "success": boolean, "reason": object }` |
| DELETE | `/reasons/:id` | Delete report reason | - | `{ "success": boolean }` |
| POST | `/block` | Block user | `{ "user_id": "string", "reason": "string?", "blocked_until": "ISO8601?" }` | `{ "success": boolean, "user": object }` |
| POST | `/unblock` | Unblock user | `{ "user_id": "string" }` | `{ "success": boolean, "user": object }` |

#### Report Object

```json
{
  "id": "string",
  "reporter_id": "string",
  "reported_user_id": "string",
  "conversation_id": "string|null",
  "reason_id": "string|null",
  "reason_text": "string|null",
  "status": "open|in_review|resolved|dismissed",
  "created_at": "string",
  "report_reasons": { "id": "string", "title": "string" }
}
```

## Payment & Wallet Management

### Base URL: `/api/payments`

All endpoints require authentication.

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/process-payment` | Process payment from frontend | `{ "amount": number, "currency": "string", "order_id": "string" }` | `{ "success": boolean, "payment": object }` |
| GET | `/payment-config` | Get payment configuration | - | `{ "success": boolean, "config": object }` |
| POST | `/create-order` | Create Razorpay order | `{ "amount": number, "currency": "string" }` | `{ "success": boolean, "order": object }` |
| GET | `/transactions` | Get transaction history | Query: `page`, `limit`, `type` | `{ "success": boolean, "transactions": array, "pagination": object }` |
| POST | `/process-final-payment` | Process final payment | `{ "razorpay_order_id": "string", "razorpay_payment_id": "string", "razorpay_signature": "string", "request_id": "string", "amount": number }` | `{ "success": boolean, "payment": object }` |
| POST | `/test-payment` | Test payment (testing only) | `{ "request_id": "string", "amount": number }` | `{ "success": boolean, "payment": object }` |
| POST | `/unfreeze-payment/:request_id` | Unfreeze payment | - | `{ "success": boolean, "payment": object }` |
| GET | `/wallet/balance` | Get wallet balance | - | `{ "success": boolean, "balance": object }` |
| POST | `/wallet/withdraw` | Withdraw from wallet | `{ "amount": number }` | `{ "success": boolean, "withdrawal": object }` |
| POST | `/refund` | Create refund | `{ "payment_id": "string", "amount": number, "reason": "string" }` | `{ "success": boolean, "refund": object }` |
| GET | `/request/:request_id/payment-details` | Get request payment details | - | `{ "success": boolean, "payment_details": object }` |

### Enhanced Wallet Management

### Base URL: `/api/enhanced-wallet`

All endpoints require authentication.

| Method | Endpoint | Description | Query Parameters | Response |
|--------|----------|-------------|------------------|----------|
| GET | `/balance` | Get comprehensive wallet balance | - | `{ "success": boolean, "balance": object }` |
| POST | `/withdraw` | Process withdrawal | - | `{ "success": boolean, "withdrawal": object }` |
| GET | `/transactions` | Get comprehensive transaction history | `page`, `limit`, `type`, `direction`, `status`, `conversation_id` | `{ "success": boolean, "transactions": array, "pagination": object }` |
| GET | `/summary` | Get transaction summary | `days` (default: 30) | `{ "success": boolean, "summary": object }` |
| GET | `/escrow-holds` | Get escrow holds | - | `{ "success": boolean, "holds": array }` |
| GET | `/breakdown` | Get wallet breakdown | - | `{ "success": boolean, "breakdown": object }` |
| POST | `/create` | Create wallet | - | `{ "success": boolean, "wallet": object }` |

---

## Message & Conversation Management

### Base URL: `/api/messages`

All endpoints require authentication.

#### Conversation Management

| Method | Endpoint | Description | Query Parameters | Response |
|--------|----------|-------------|------------------|----------|
| GET | `/conversations` | Get campaign/bid conversations | `page`, `limit`, `type` | `{ "success": boolean, "conversations": array }` |
| GET | `/conversations/direct` | Get direct conversations | `page`, `limit` | `{ "success": boolean, "conversations": array }` |
| GET | `/conversations/bids` | Get bid conversations | `page`, `limit` | `{ "success": boolean, "conversations": array }` |
| GET | `/conversations/campaigns` | Get campaign conversations | `page`, `limit` | `{ "success": boolean, "conversations": array }` |
| GET | `/conversations/:conversation_id/messages` | Get conversation messages | `page`, `limit` | `{ "success": boolean, "messages": array }` |
| GET | `/conversations/:conversation_id/context` | Get conversation context | - | `{ "success": boolean, "context": object }` |

#### Message Operations

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/conversations/:conversation_id/messages` | Send message | `{ "message": "string", "type": "string" }` | `{ "success": boolean, "message": object }` |
| PUT | `/conversations/:conversation_id/seen` | Mark messages as seen | - | `{ "success": boolean }` |
| DELETE | `/messages/:message_id` | Delete message | - | `{ "success": boolean }` |

#### Utility

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| GET | `/unread-count` | Get unread message count | `{ "success": boolean, "unread_count": number }` |

---

## Subscription Management

### Base URL: `/api/subscriptions`

#### Public Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/plans` | Get available subscription plans | - | `{ "success": boolean, "plans": array }` |
| GET | `/payment-config` | Get payment configuration | - | `{ "success": boolean, "config": object }` |
| POST | `/webhook` | Handle webhook events | Webhook payload | `{ "success": boolean }` |
| POST | `/check-unprocessed-payments` | Check unprocessed payments | - | `{ "success": boolean, "payments": array }` |

#### Protected Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/status` | Get subscription status | - | `{ "success": boolean, "subscription": object }` |
| POST | `/create-order` | Create subscription order | `{ "plan_id": "string" }` | `{ "success": boolean, "order": object }` |
| POST | `/process-payment` | Process subscription payment | `{ "order_id": "string", "payment_data": object }` | `{ "success": boolean, "payment": object }` |
| POST | `/create-free` | Create free subscription | `{ "plan_id": "string" }` | `{ "success": boolean, "subscription": object }` |
| GET | `/payment-status/:payment_id` | Get payment status | - | `{ "success": boolean, "status": object }` |
| POST | `/update-payment-status` | Update payment status | `{ "payment_id": "string", "status": "string" }` | `{ "success": boolean, "payment": object }` |
| POST | `/cancel` | Cancel subscription | - | `{ "success": boolean, "subscription": object }` |
| GET | `/history` | Get subscription history | - | `{ "success": boolean, "history": array }` |

---

## File & Attachment Management

### Base URL: `/api/attachments`

All endpoints require authentication.

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/conversations/:conversation_id/upload` | Upload attachment | FormData with file | `{ "success": boolean, "attachment": object }` |
| POST | `/conversations/:conversation_id/send-with-attachment` | Send message with attachment | FormData with file and message | `{ "success": boolean, "message": object }` |
| POST | `/conversations/:conversation_id/upload-formdata` | Upload with FormData | FormData with file | `{ "success": boolean, "attachment": object }` |
| DELETE | `/attachments/:attachment_id` | Delete attachment | - | `{ "success": boolean }` |
| GET | `/attachments/:attachment_id` | Get attachment info | - | `{ "success": boolean, "attachment": object }` |
| GET | `/supported-types` | Get supported file types | - | `{ "success": boolean, "fileTypes": array }` |

### Direct Storage Management

### Base URL: `/api/files`

All endpoints require authentication.

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/conversations/:conversation_id/upload` | Upload file and send message | FormData with file | `{ "success": boolean, "message": object }` |
| DELETE | `/files/:message_id` | Delete file | - | `{ "success": boolean }` |
| GET | `/files/:message_id` | Get file info | - | `{ "success": boolean, "file": object }` |
| GET | `/supported-types` | Get supported file types | - | `{ "success": boolean, "types": array }` |

---

## Social Platform Management

### Base URL: `/api/social-platforms`

All endpoints require authentication.

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/` | Get social platforms | - | `{ "success": boolean, "platforms": array }` |
| POST | `/` | Add social platform | `{ "platform": "string", "username": "string", "followers": number }` | `{ "success": boolean, "platform": object }` |
| PUT | `/:id` | Update social platform | `{ "platform": "string", "username": "string", "followers": number }` | `{ "success": boolean, "platform": object }` |
| DELETE | `/:id` | Delete social platform | - | `{ "success": boolean }` |
| GET | `/stats` | Get social platform statistics | - | `{ "success": boolean, "stats": object }` |

---

## Coupon Management

### Base URL: `/api/coupons`

All endpoints require authentication.

#### User Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/validate` | Validate coupon code | `{ "code": "string" }` | `{ "success": boolean, "valid": boolean, "discount": object }` |
| POST | `/apply` | Apply coupon code | `{ "code": "string", "subscription_id": "string" }` | `{ "success": boolean, "applied": boolean, "discount": object }` |
| POST | `/create-subscription` | Create subscription with coupon | `{ "plan_id": "string", "coupon_code": "string" }` | `{ "success": boolean, "subscription": object }` |
| GET | `/history` | Get coupon usage history | - | `{ "success": boolean, "history": array }` |

#### Admin Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/admin/all` | Get all coupons | Query: `page`, `limit`, `status` | `{ "success": boolean, "coupons": array, "pagination": object }` |
| POST | `/admin/create` | Create new coupon | `{ "code": "string", "discount_type": "string", "discount_value": number, "valid_until": "string" }` | `{ "success": boolean, "coupon": object }` |
| PUT | `/admin/:couponId` | Update coupon | `{ "code": "string", "discount_type": "string", "discount_value": number, "valid_until": "string" }` | `{ "success": boolean, "coupon": object }` |
| DELETE | `/admin/:couponId` | Delete coupon | - | `{ "success": boolean }` |
| GET | `/admin/stats` | Get coupon statistics | - | `{ "success": boolean, "stats": object }` |

---

## FCM & Notifications

### Base URL: `/api/fcm`

All endpoints require authentication.

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/register` | Register FCM token | `{ "token": "string", "device_type": "string" }` | `{ "success": boolean, "registered": boolean }` |
| POST | `/unregister` | Unregister FCM token | `{ "token": "string" }` | `{ "success": boolean, "unregistered": boolean }` |
| GET | `/tokens` | Get user's FCM tokens | - | `{ "success": boolean, "tokens": array }` |
| POST | `/test` | Send test notification | `{ "title": "string", "body": "string", "data": object }` | `{ "success": boolean, "sent": boolean }` |
| POST | `/cleanup` | Cleanup inactive tokens (admin only) | - | `{ "success": boolean, "cleaned": number }` |

---

## System & Health Endpoints

### Base URL: `/`

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| GET | `/health` | Health check | `{ "success": boolean, "message": "string", "timestamp": "string", "environment": "string" }` |
| GET | `/test-socket` | Test Socket.IO connection | `{ "success": boolean, "message": "string", "timestamp": "string", "hasIo": boolean, "connectedClients": number }` |
| GET | `/test-fcm` | Test FCM service status | `{ "success": boolean, "fcmInitialized": boolean, "message": "string" }` |
| POST | `/test-message` | Test realtime messaging | `{ "success": boolean, "message": "string", "testMessage": object, "conversationContext": object, "events": array }` |

### Webhook Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/webhook/razorpay` | Razorpay webhook handler | Razorpay webhook payload | `{ "success": boolean }` |

---

## Authentication & Authorization

### Authentication Headers

All protected endpoints require the following header:
```
Authorization: Bearer <access_token>
```

### Role-Based Access Control

The application supports the following roles:
- **admin**: Full access to all endpoints (no restrictions)
- **brand_owner**: Access to campaigns, bids, and payment management
- **influencer**: Access to requests, work submission, and profile management

**Admin Role Implementation:**
- Admin is a regular user with `role: "admin"` in the database
- JWT token contains the role information
- Middleware `requireRole(['admin'])` grants access to admin-only endpoints
- Database RLS policies include admin access for all tables
- No special admin authentication flow needed

### Token Management

- **Access Token**: Short-lived token for API requests (typically 15 minutes)
- **Refresh Token**: Long-lived token for obtaining new access tokens
- **Token Refresh**: Use `/api/auth/refresh-token` to get new access tokens

---

## Error Handling

### Standard Error Response Format

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Specific field error"
  }
}
```

### Common HTTP Status Codes

- **200**: Success
- **201**: Created
- **400**: Bad Request
- **401**: Unauthorized
- **403**: Forbidden
- **404**: Not Found
- **422**: Validation Error
- **500**: Internal Server Error

---

## Rate Limiting

The application implements rate limiting for:
- OTP requests: 5 requests per minute per phone number
- API requests: 1000 requests per hour per user
- File uploads: 10 uploads per minute per user

---

## WebSocket Events

The application supports real-time communication via WebSocket:

### Connection Events
- `connection`: Client connects
- `disconnect`: Client disconnects

### Message Events
- `new_message`: New message received
- `message_sent`: Message sent confirmation
- `notification`: Push notification
- `conversation_list_updated`: Conversation list update
- `unread_count_updated`: Unread count update

### Flow Events
- `flow_state_changed`: Conversation flow state change
- `button_click`: Interactive button click
- `text_input`: Text input response

---

## Admin Panel Integration Tips

1. **Authentication Flow**: Implement proper token management with refresh logic
2. **Role Management**: Check user roles before showing/hiding features
3. **Real-time Updates**: Use WebSocket for live data updates
4. **File Uploads**: Handle multipart/form-data for file uploads
5. **Error Handling**: Implement comprehensive error handling and user feedback
6. **Pagination**: Use pagination for large data sets
7. **Search & Filtering**: Implement search and filtering for better UX
8. **Caching**: Consider caching frequently accessed data
9. **Webhooks**: Handle webhook events for payment and subscription updates
10. **Testing**: Use test endpoints for development and testing

---

## Support

For technical support or questions about API integration, please refer to the individual controller files in the `controllers/` directory or contact the development team.

