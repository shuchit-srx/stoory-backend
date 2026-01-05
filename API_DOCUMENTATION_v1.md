# Stoory Backend API Documentation - Version 1

**Generated:** 2024-12-19

## Table of Contents

1. [Authentication](#authentication)
2. [Brand Authentication](#brand-authentication)
3. [Profile Management](#profile-management)
4. [User Management](#user-management)
5. [Campaign Management](#campaign-management)
6. [Application Management](#application-management)
7. [Chat Management](#chat-management)
8. [Plan Management](#plan-management)
9. [Subscription Management](#subscription-management)
10. [Payment Management](#payment-management)

---

## Authentication

### POST /api/v1/auth/send-otp

**Description:** Send OTP to phone number (for influencer registration/login)

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "phone": "string (required) - Phone number with country code (e.g., +1234567890). Must start with + and be 6-14 digits after country code"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "OTP sent successfully"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message",
  "code": "ERROR_CODE"
}
```

---

### POST /api/v1/auth/send-registration-otp

**Description:** Send registration OTP to phone number (for new influencer registration)

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "phone": "string (required) - Phone number with country code (e.g., +1234567890). Must start with + and be 6-14 digits after country code"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Registration OTP sent successfully"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message",
  "code": "ERROR_CODE"
}
```

---

### POST /api/v1/auth/verify-otp

**Description:** Verify OTP and authenticate user

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "phone": "string (required) - Phone number with country code",
  "token": "string (required) - OTP token (4-6 characters)",
  "userData": "object (optional) - Additional user data for registration"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "phone": "string",
    "role": "INFLUENCER",
    ...
  },
  "token": "jwt_token",
  "refreshToken": "refresh_token",
  "message": "Authentication successful"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message"
}
```

---

### POST /api/v1/auth/refresh-token

**Description:** Refresh authentication token

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "refreshToken": "string (required) - Refresh token"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "data": {
    "token": "new_jwt_token",
    "refreshToken": "new_refresh_token"
  }
}
```

**Response (Error - 400/401):**
```json
{
  "success": false,
  "message": "Error message",
  "code": "ERROR_CODE"
}
```

---

### GET /api/v1/auth/whatsapp-status

**Description:** Get WhatsApp service status

**Method:** GET

**Authentication:** Not required (Public)

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "whatsapp": {
    "status": "connected|disconnected",
    ...
  }
}
```

---

## Brand Authentication

### POST /api/v1/auth/brand/register

**Description:** Register a new brand owner

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "email": "string (required) - Valid email address",
  "password": "string (required) - Password (min 8 chars, must contain uppercase, lowercase, and number)",
  "name": "string (optional) - Name (2-100 characters)"
}
```

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Brand owner registered successfully",
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "BRAND",
    ...
  }
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

---

### POST /api/v1/auth/brand/login

**Description:** Login as brand owner

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "email": "string (required) - Valid email address",
  "password": "string (required) - Password"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "BRAND",
    ...
  },
  "token": "jwt_token",
  "refreshToken": "refresh_token",
  "message": "Login successful"
}
```

**Response (Error - 401):**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

---

### POST /api/v1/auth/brand/verify-email

**Description:** Verify brand owner email address

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "token": "string (required) - Email verification token"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

---

### POST /api/v1/auth/brand/resend-verification

**Description:** Resend email verification code

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "email": "string (required) - Valid email address"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Verification email sent successfully"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message"
}
```

---

### POST /api/v1/auth/brand/forgot-password

**Description:** Request password reset

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "email": "string (required) - Valid email address"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Password reset email sent successfully"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message"
}
```

---

### POST /api/v1/auth/brand/reset-password

**Description:** Reset password with token

**Method:** POST

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "token": "string (required) - Password reset token",
  "new_password": "string (required) - New password (min 8 chars, must contain uppercase, lowercase, and number)"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

---

## Profile Management

### PUT /api/v1/auth/profile/complete

**Description:** Complete user profile. Accepts JSON or multipart/form-data. For influencers: profileImage file. For brands: brandLogo file.

**Method:** PUT

**Authentication:** Required (Bearer Token) - All authenticated users

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json OR multipart/form-data
```

**Request Body (JSON):**
```json
{
  "pan_number": "string (optional) - PAN number (10 characters)",
  "upi_id": "string (optional) - UPI ID",
  "social_platforms": [
    {
      "platform_name": "string",
      "username": "string",
      "profile_url": "string (URL)",
      "follower_count": "number (>=0)",
      "engagement_rate": "number (0-100)",
      "data_source": "MANUAL | GRAPH_API"
    }
  ],
  "languages": ["string"],
  "categories": ["string"],
  "bio": "string (optional) - Bio (max 5000 chars)",
  "city": "string (optional) - City (max 200 chars)",
  "country": "string (optional) - Country (max 200 chars)",
  "gender": "MALE | FEMALE | OTHER",
  "tier": "NANO | MICRO | MID | MACRO",
  "min_value": "number (optional)",
  "max_value": "number (optional)",
  "brand_name": "string (optional) - Brand name (2-200 chars)",
  "brand_description": "string (optional) - Brand description (max 5000 chars)"
}
```

**Request Body (Multipart/Form-Data):**
- All JSON fields above as form fields
- `profileImage`: file (optional) - Profile image file (max 5MB) - for influencers
- `brandLogo`: file (optional) - Brand logo file (max 5MB) - for brands

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Profile completed successfully",
  "profile": {
    ...
  }
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

---

## User Management

### GET /api/v1/users/me

**Description:** Get current user details with all related data

**Method:** GET

**Authentication:** Required (Bearer Token) - All authenticated users

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "phone": "string",
      "email": "string",
      "role": "INFLUENCER | BRAND | ADMIN",
      ...
    },
    "profile": {
      ...
    },
    ...
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "message": "User not found",
  "error": "Error details"
}
```

---

## Campaign Management

### POST /api/v1/campaigns

**Description:** Create a new campaign. Accepts multipart/form-data with optional coverImage file.

**Method:** POST

**Authentication:** Required (Bearer Token) - BRAND role only

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json OR multipart/form-data
```

**Request Body (JSON):**
```json
{
  "title": "string (required) - Campaign title (3-200 chars)",
  "type": "NORMAL | BULK",
  "status": "DRAFT | LIVE | LOCKED | ACTIVE | COMPLETED | EXPIRED | CANCELLED",
  "min_influencers": "number (optional) - Minimum influencers (>=0)",
  "max_influencers": "number (optional) - Maximum influencers (>=1). Must be >= min_influencers",
  "requires_script": "boolean (optional)",
  "start_deadline": "string (required) - ISO 8601 date string",
  "budget": "number (optional) - Budget (>=0)",
  "description": "string (optional) - Description (max 5000 chars)",
  "platform": ["string"],
  "content_type": ["string"],
  "influencer_tier": "NANO | MICRO | MID | MACRO",
  "categories": "string (optional) - Categories (max 500 chars)",
  "language": "string (optional) - Language (max 50 chars)",
  "brand_guideline": "string (optional) - Brand guidelines (max 10000 chars)"
}
```

**Request Body (Multipart/Form-Data):**
- All JSON fields above as form fields
- `coverImage`: file (optional) - Cover image file (max 5MB)

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Campaign created successfully",
  "campaign": {
    "id": "uuid",
    "title": "string",
    "brand_id": "uuid",
    ...
  }
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

---

### GET /api/v1/campaigns

**Description:** Get all campaigns with filtering and pagination

**Method:** GET

**Authentication:** Required (Bearer Token) - All authenticated users

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Query Parameters:**
- `status`: string (optional) - Filter by status
- `type`: string (optional) - Filter by type ("NORMAL" | "BULK")
- `brand_id`: string (optional) - UUID - Filter by brand ID
- `min_budget`: number (optional) - Minimum budget filter (>=0)
- `max_budget`: number (optional) - Maximum budget filter (>=0)
- `search`: string (optional) - Search query (1-100 chars)
- `page`: number (optional) - Page number (>=1)
- `limit`: number (optional) - Items per page (1-100)

**Response (Success - 200):**
```json
{
  "success": true,
  "campaigns": [
    {
      "id": "uuid",
      "title": "string",
      "brand_id": "uuid",
      ...
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

---

### GET /api/v1/campaigns/my

**Description:** Get campaigns created by authenticated brand owner

**Method:** GET

**Authentication:** Required (Bearer Token) - BRAND role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Query Parameters:**
- Same as GET /api/v1/campaigns

**Response (Success - 200):**
```json
{
  "success": true,
  "campaigns": [
    {
      "id": "uuid",
      "title": "string",
      "brand_id": "uuid",
      ...
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

---

### GET /api/v1/campaigns/:id

**Description:** Get single campaign by ID

**Method:** GET

**Authentication:** Required (Bearer Token) - All authenticated users

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "campaign": {
    "id": "uuid",
    "title": "string",
    "brand_id": "uuid",
    "description": "string",
    ...
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "message": "Campaign not found"
}
```

---

### PUT /api/v1/campaigns/:id

**Description:** Update campaign. Accepts multipart/form-data with optional coverImage file.

**Method:** PUT

**Authentication:** Required (Bearer Token) - BRAND role only

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json OR multipart/form-data
```

**Request Body:** Same as POST /api/v1/campaigns (all fields optional)

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Campaign updated successfully",
  "campaign": {
    "id": "uuid",
    "title": "string",
    ...
  }
}
```

**Response (Error - 400/404):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

---

### DELETE /api/v1/campaigns/:id

**Description:** Delete campaign

**Method:** DELETE

**Authentication:** Required (Bearer Token) - BRAND role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Campaign deleted successfully"
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "message": "Campaign not found"
}
```

---

## Application Management

### POST /api/v1/applications

**Description:** Apply to a campaign

**Method:** POST

**Authentication:** Required (Bearer Token) - INFLUENCER role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "campaignId": "string (required) - UUID - Campaign ID to apply to"
}
```

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Application submitted successfully",
  "application": {
    "id": "uuid",
    "campaign_id": "uuid",
    "influencer_id": "uuid",
    "status": "PENDING",
    ...
  }
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

---

### POST /api/v1/applications/:id/accept

**Description:** Accept an application

**Method:** POST

**Authentication:** Required (Bearer Token) - BRAND role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "agreedAmount": "number (required) - Agreed amount (>=0)",
  "platformFeePercent": "number (required) - Platform fee percentage (0-100)",
  "requiresScript": "boolean (optional)"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Application accepted successfully",
  "application": {
    "id": "uuid",
    "status": "ACCEPTED",
    "agreed_amount": "number",
    ...
  }
}
```

**Response (Error - 400/404):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

---

### POST /api/v1/applications/bulk-accept

**Description:** Bulk accept multiple applications for a campaign at once

**Method:** POST

**Authentication:** Required (Bearer Token) - BRAND role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "campaignId": "string (required) - UUID - Campaign ID that all applications belong to",
  "applications": [
    {
      "applicationId": "string (required) - UUID - Application ID",
      "agreedAmount": "number (required) - Agreed amount (>=0)",
      "platformFeePercent": "number (required) - Platform fee percentage (0-100)",
      "requiresScript": "boolean (optional) - Whether script is required (defaults to false)"
    }
  ]
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Bulk accept completed. 3 succeeded, 0 failed.",
  "total": 3,
  "succeeded": 3,
  "failed": 0,
  "results": [
    {
      "applicationId": "uuid",
      "success": true,
      "message": "Application accepted successfully",
      "application": {
        "id": "uuid",
        "campaign_id": "uuid",
        "influencer_id": "uuid",
        "status": "ACCEPTED",
        "phase": "WORK | SCRIPT",
        "agreed_amount": "number",
        "platform_fee_percent": "number",
        "platform_fee_amount": "number",
        "net_amount": "number",
        ...
      }
    }
  ]
}
```

**Response (Partial Success - 207):**
```json
{
  "success": false,
  "message": "Bulk accept completed. 2 succeeded, 1 failed.",
  "total": 3,
  "succeeded": 2,
  "failed": 1,
  "results": [
    {
      "applicationId": "uuid",
      "success": true,
      "message": "Application accepted successfully",
      "application": { ... }
    },
    {
      "applicationId": "uuid",
      "success": false,
      "message": "Cannot accept application. Current status: ACCEPTED"
    },
    {
      "applicationId": "uuid",
      "success": true,
      "message": "Application accepted successfully",
      "application": { ... }
    }
  ],
  "errors": [
    {
      "applicationId": "uuid",
      "error": "Cannot accept application. Current status: ACCEPTED"
    }
  ]
}
```

**Response (Error - 400/404):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

**Response (Error - 400 - Validation):**
```json
{
  "errors": [
    {
      "msg": "campaignId is required",
      "param": "campaignId",
      "location": "body"
    }
  ]
}
```

---

### POST /api/v1/applications/:id/cancel

**Description:** Cancel an application

**Method:** POST

**Authentication:** Required (Bearer Token) - Brand owner or Influencer of the application

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Application cancelled successfully",
  "application": {
    "id": "uuid",
    "status": "CANCELLED",
    ...
  }
}
```

**Response (Error - 400/404):**
```json
{
  "success": false,
  "message": "Error message"
}
```

---

### POST /api/v1/applications/:id/complete

**Description:** Mark application as completed

**Method:** POST

**Authentication:** Required (Bearer Token) - ADMIN role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Application marked as completed",
  "application": {
    "id": "uuid",
    "status": "COMPLETED",
    ...
  }
}
```

**Response (Error - 400/404):**
```json
{
  "success": false,
  "message": "Error message"
}
```

---

## Chat Management

### GET /api/v1/chat/:applicationId

**Description:** Get chat details for an application

**Method:** GET

**Authentication:** Required (Bearer Token) - All authenticated users

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "chat": {
    "id": "uuid",
    "application_id": "uuid",
    ...
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "message": "Chat not found"
}
```

---

### POST /api/v1/chat/:applicationId

**Description:** Create a chat for an application (typically called when application is accepted)

**Method:** POST

**Authentication:** Required (Bearer Token) - All authenticated users

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Chat created successfully",
  "chat": {
    "id": "uuid",
    "application_id": "uuid",
    ...
  }
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message"
}
```

---

### GET /api/v1/chat/:applicationId/history

**Description:** Get chat history for an application

**Method:** GET

**Authentication:** Required (Bearer Token) - All authenticated users

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Query Parameters:**
- `limit`: number (optional) - Number of messages to retrieve (default: 50, max: 100)
- `offset`: number (optional) - Offset for pagination (default: 0)

**Response (Success - 200):**
```json
{
  "success": true,
  "messages": [
    {
      "id": "uuid",
      "chat_id": "uuid",
      "sender_id": "uuid",
      "content": "string",
      "created_at": "timestamp",
      ...
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 100
  }
}
```

---

## Plan Management

### GET /api/v1/plans

**Description:** Get all active plans

**Method:** GET

**Authentication:** Required (Bearer Token) - BRAND, ADMIN roles

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "plans": [
    {
      "id": "uuid",
      "name": "string",
      "price": "number",
      "billing_cycle": "MONTHLY | YEARLY",
      "features": {},
      "is_active": true,
      ...
    }
  ]
}
```

---

### POST /api/v1/plans

**Description:** Create a new plan

**Method:** POST

**Authentication:** Required (Bearer Token) - ADMIN role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "name": "string (required) - Plan name (1-200 chars)",
  "features": "object (optional) - Features object",
  "price": "number (required) - Price (>=0)",
  "billing_cycle": "MONTHLY | YEARLY",
  "is_active": "boolean (optional)"
}
```

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Plan created successfully",
  "plan": {
    "id": "uuid",
    "name": "string",
    "price": "number",
    "billing_cycle": "MONTHLY | YEARLY",
    ...
  }
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

---

### PUT /api/v1/plans/:id

**Description:** Update a plan

**Method:** PUT

**Authentication:** Required (Bearer Token) - ADMIN role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "name": "string (optional) - Plan name (1-200 chars)",
  "features": "object (optional) - Features object",
  "price": "number (optional) - Price (>=0)",
  "billing_cycle": "MONTHLY | YEARLY",
  "is_active": "boolean (optional)"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Plan updated successfully",
  "plan": {
    "id": "uuid",
    "name": "string",
    ...
  }
}
```

**Response (Error - 400/404):**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

---

## Subscription Management

### POST /api/v1/subscriptions

**Description:** Create a new subscription for authenticated brand user

**Method:** POST

**Authentication:** Required (Bearer Token) - BRAND role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "plan_id": "string (required) - UUID - Plan ID",
  "is_auto_renew": "boolean (optional)"
}
```

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Subscription created successfully",
  "subscription": {
    "id": "uuid",
    "user_id": "uuid",
    "plan_id": "uuid",
    "status": "ACTIVE",
    ...
  }
}
```

**Response (Error - 400/404):**
```json
{
  "success": false,
  "message": "Error message",
  "error": "Error details"
}
```

---

### GET /api/v1/subscriptions/all

**Description:** Get all subscriptions

**Method:** GET

**Authentication:** Required (Bearer Token) - ADMIN role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "subscriptions": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "plan_id": "uuid",
      "status": "ACTIVE | CANCELLED",
      ...
    }
  ]
}
```

---

### GET /api/v1/subscriptions/current/:userId

**Description:** Get current subscription for any brand

**Method:** GET

**Authentication:** Required (Bearer Token) - ADMIN role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid",
    "user_id": "uuid",
    "plan_id": "uuid",
    "status": "ACTIVE",
    ...
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "message": "No active subscription found"
}
```

---

### DELETE /api/v1/subscriptions

**Description:** Cancel subscription for authenticated brand user

**Method:** DELETE

**Authentication:** Required (Bearer Token) - BRAND role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Subscription cancelled successfully",
  "subscription": {
    "id": "uuid",
    "status": "CANCELLED",
    ...
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "message": "Subscription not found"
}
```

---

### DELETE /api/v1/subscriptions/:userId

**Description:** Cancel subscription for any brand

**Method:** DELETE

**Authentication:** Required (Bearer Token) - ADMIN role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Subscription cancelled successfully",
  "subscription": {
    "id": "uuid",
    "status": "CANCELLED",
    ...
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "message": "Subscription not found"
}
```

---

## Payment Management

### GET /api/v1/payments/config

**Description:** Get payment config (Razorpay key) for frontend

**Method:** GET

**Authentication:** Required (Bearer Token) - All authenticated users

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "config": {
    "razorpay_key": "string",
    ...
  }
}
```

**Response (Error - 503):**
```json
{
  "success": false,
  "message": "Payment service is not configured"
}
```

---

### POST /api/v1/payments/applications/:applicationId

**Description:** Create payment order for application (Brand pays admin after application completion)

**Method:** POST

**Authentication:** Required (Bearer Token) - BRAND, ADMIN roles

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Payment order created successfully",
  "order": {
    "id": "string",
    "amount": "number",
    ...
  },
  "payment_order": {
    "id": "uuid",
    "application_id": "uuid",
    ...
  },
  "breakdown": {
    "total_amount": "number",
    "platform_fee": "number",
    ...
  }
}
```

**Response (Error - 400/404/503):**
```json
{
  "success": false,
  "message": "Error message",
  "error": "Error details"
}
```

---

### POST /api/v1/payments/verify

**Description:** Verify payment

**Method:** POST

**Authentication:** Required (Bearer Token) - BRAND, ADMIN roles

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "razorpay_order_id": "string (required) - Razorpay order ID",
  "razorpay_payment_id": "string (required) - Razorpay payment ID",
  "razorpay_signature": "string (required) - Razorpay signature",
  "application_id": "string (required) - UUID - Application ID"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "payment_order": {
    "id": "uuid",
    "status": "VERIFIED",
    ...
  }
}
```

**Response (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "Error message",
  "error": "Error details"
}
```

---

### POST /api/v1/payments/applications/:applicationId/release

**Description:** Release payout to influencer

**Method:** POST

**Authentication:** Required (Bearer Token) - ADMIN role only

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Payout released successfully",
  "payout_amount_paise": "number",
  "commission_amount_paise": "number",
  "new_wallet_balance_paise": "number"
}
```

**Response (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "Error message",
  "error": "Error details"
}
```

---

### GET /api/v1/payments/applications/:applicationId

**Description:** Get payments for an application

**Method:** GET

**Authentication:** Required (Bearer Token) - Brand owner, Influencer, or Admin of the application

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** None

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Payments fetched successfully",
  "payments": [
    {
      "id": "uuid",
      "application_id": "uuid",
      "amount": "number",
      "status": "PENDING | VERIFIED | RELEASED",
      ...
    }
  ]
}
```

**Response (Error - 403/404/500):**
```json
{
  "success": false,
  "message": "Error message",
  "error": "Error details"
}
```

---

## Authentication Notes

### JWT Token Format

Most endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

### Permission Levels

- **Public**: No authentication required
- **Authenticated**: Requires valid JWT token (any role)
- **BRAND**: Requires authentication + BRAND role
- **INFLUENCER**: Requires authentication + INFLUENCER role
- **ADMIN**: Requires authentication + ADMIN role

### Error Responses

All error responses follow this general format:

```json
{
  "success": false,
  "message": "Error message",
  "errors": [] // Optional - validation errors
}
```

### Common HTTP Status Codes

- **200**: Success
- **201**: Created
- **400**: Bad Request (validation errors, invalid input)
- **401**: Unauthorized (missing or invalid token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **500**: Internal Server Error
- **503**: Service Unavailable

---

**Document Version:** 1.1  
**Last Updated:** 2024-12-19

