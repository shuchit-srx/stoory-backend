# v1 API Endpoints Documentation

Complete documentation of all endpoints in `/api/v1` with HTTP methods and request body structures.

---

## Authentication Routes (`/api/v1/auth`)

### POST `/api/v1/auth/send-otp`
**Description:** Send OTP for influencer phone authentication

**Request Body:**
```json
{
  "phone": "string (required)" // Must start with +, international format (+[country code][number])
}
```

**Fields:**
- `phone` (required) - Valid phone number with country code (e.g., +1234567890)

---

### POST `/api/v1/auth/send-registration-otp`
**Description:** Send OTP for new user registration

**Request Body:**
```json
{
  "phone": "string (required)" // Must start with +, international format (+[country code][number])
}
```

**Fields:**
- `phone` (required) - Valid phone number with country code (e.g., +1234567890)

---

### POST `/api/v1/auth/verify-otp`
**Description:** Verify OTP and authenticate influencer

**Request Body:**
```json
{
  "phone": "string (required)", // Must start with +, international format
  "token": "string (required)"  // OTP token, 4-6 characters
}
```

**Fields:**
- `phone` (required) - Valid phone number with country code
- `token` (required) - OTP token (4-6 characters)

---

### POST `/api/v1/auth/refresh-token`
**Description:** Refresh access token using refresh token

**Request Body:**
```json
{
  "refreshToken": "string (required)"
}
```

**Fields:**
- `refreshToken` (required) - Valid refresh token string

---

### GET `/api/v1/auth/whatsapp-status`
**Description:** Get WhatsApp service status

**Request Body:** None

---

### POST `/api/v1/auth/brand/register`
**Description:** Register a new brand owner

**Request Body:**
```json
{
  "email": "string (required)",    // Valid email address
  "password": "string (required)", // Min 8 chars, must contain uppercase, lowercase, and number
  "name": "string (optional)"      // 2-100 characters
}
```

**Fields:**
- `email` (required) - Valid email address
- `password` (required) - Minimum 8 characters, must contain at least one uppercase letter, one lowercase letter, and one number
- `name` (optional) - Name between 2-100 characters

---

### POST `/api/v1/auth/brand/login`
**Description:** Login for brand owner

**Request Body:**
```json
{
  "email": "string (required)",    // Valid email address
  "password": "string (required)"  // Password string
}
```

**Fields:**
- `email` (required) - Valid email address
- `password` (required) - Password string

---

### POST `/api/v1/auth/brand/verify-email`
**Description:** Verify brand owner email address

**Request Body:**
```json
{
  "token": "string (required)" // Email verification token
}
```

**Fields:**
- `token` (required) - Email verification token

---

### POST `/api/v1/auth/brand/resend-verification`
**Description:** Resend email verification

**Request Body:**
```json
{
  "email": "string (required)" // Valid email address
}
```

**Fields:**
- `email` (required) - Valid email address

---

### POST `/api/v1/auth/brand/forgot-password`
**Description:** Request password reset

**Request Body:**
```json
{
  "email": "string (required)" // Valid email address
}
```

**Fields:**
- `email` (required) - Valid email address

---

### POST `/api/v1/auth/brand/reset-password`
**Description:** Reset password using reset token

**Request Body:**
```json
{
  "token": "string (required)",        // Password reset token
  "new_password": "string (required)"  // Min 8 chars, must contain uppercase, lowercase, and number
}
```

**Fields:**
- `token` (required) - Password reset token
- `new_password` (required) - Minimum 8 characters, must contain at least one uppercase letter, one lowercase letter, and one number

---

### PUT `/api/v1/auth/profile/complete`
**Description:** Complete user profile (supports multipart/form-data for file uploads)

**Content-Type:** `application/json` or `multipart/form-data`

**Request Body (JSON):**
```json
{
  "pan_number": "string (optional)",           // 10 characters
  "upi_id": "string (optional)",
  "social_platforms": [                        // Array of objects (optional)
    {
      "platform_name": "string (optional)",
      "username": "string (optional)",
      "profile_url": "string (optional)",      // Valid URL
      "follower_count": "number (optional)",   // Non-negative integer
      "engagement_rate": "number (optional)",  // Float between 0-100
      "data_source": "string (optional)"       // "MANUAL" or "GRAPH_API"
    }
  ],
  "languages": ["string (optional)"],          // Array of strings
  "categories": ["string (optional)"],         // Array of strings
  "bio": "string (optional)",                  // Up to 5000 characters
  "city": "string (optional)",                 // Up to 200 characters
  "country": "string (optional)",              // Up to 200 characters
  "gender": "string (optional)",               // "MALE", "FEMALE", or "OTHER"
  "tier": "string (optional)",                 // "NANO", "MICRO", "MID", or "MACRO" (Influencer only)
  "min_value": "number (optional)",            // Numeric (Influencer only)
  "max_value": "number (optional)",            // Numeric (Influencer only)
  "brand_name": "string (optional)",           // 2-200 characters (Brand only)
  "brand_description": "string (optional)"     // Up to 5000 characters (Brand only)
}
```

**Request Body (multipart/form-data):**
- All JSON fields above as form fields (where applicable)
- `profileImage` (optional) - Image file, max 5MB (Influencer only)
- `brandLogo` (optional) - Image file, max 5MB (Brand only)

**Fields:**
- All fields are optional
- File uploads: `profileImage` or `brandLogo` (multipart/form-data only)

---

## Campaign Routes (`/api/v1/campaigns`)

### POST `/api/v1/campaigns`
**Description:** Create a new campaign (Brand Owner only)

**Content-Type:** `application/json` or `multipart/form-data`

**Request Body (JSON):**
```json
{
  "title": "string (required)",                    // 3-200 characters
  "type": "string (optional)",                     // "NORMAL" or "BULK"
  "status": "string (optional)",                   // "DRAFT", "LIVE", "LOCKED", "ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED"
  "min_influencers": "number (optional)",          // Non-negative integer
  "max_influencers": "number (optional)",          // Positive integer (must be >= min_influencers)
  "requires_script": "boolean (optional)",
  "start_deadline": "string (required)",           // ISO 8601 date
  "budget": "number (optional)",                   // Non-negative number
  "description": "string (optional)",              // Up to 5000 characters
  "platform": ["string (optional)"],               // Array of strings
  "content_type": ["string (optional)"],           // Array of strings
  "influencer_tier": "string (optional)",          // "NANO", "MICRO", "MID", or "MACRO"
  "categories": "string (optional)",               // Up to 500 characters
  "language": "string (optional)"                  // Up to 50 characters
}
```

**Request Body (multipart/form-data):**
- All JSON fields above as form fields
- `coverImage` (optional) - Image file, max 5MB

**Fields:**
- `title` (required) - Campaign title, 3-200 characters
- `start_deadline` (required) - ISO 8601 date string
- All other fields are optional

---

### GET `/api/v1/campaigns`
**Description:** Get all campaigns with filtering and pagination

**Request Body:** None

**Query Parameters:**
- `status` (optional) - Filter by status
- `type` (optional) - Filter by type ("NORMAL" or "BULK")
- `brand_id` (optional) - Filter by brand UUID
- `min_budget` (optional) - Minimum budget filter (number)
- `max_budget` (optional) - Maximum budget filter (number)
- `search` (optional) - Search query (1-100 characters)
- `page` (optional) - Page number (positive integer)
- `limit` (optional) - Results per page (1-100, default varies)

---

### GET `/api/v1/campaigns/my`
**Description:** Get campaigns created by authenticated brand owner (Brand Owner only)

**Request Body:** None

**Query Parameters:** Same as GET `/api/v1/campaigns`

---

### GET `/api/v1/campaigns/:id`
**Description:** Get single campaign by ID

**Request Body:** None

**URL Parameters:**
- `id` (required) - Campaign UUID

---

### PUT `/api/v1/campaigns/:id`
**Description:** Update campaign (Brand Owner only)

**Content-Type:** `application/json` or `multipart/form-data`

**Request Body:** Same structure as POST `/api/v1/campaigns`, but all fields are optional (including `title` and `start_deadline`)

**URL Parameters:**
- `id` (required) - Campaign UUID

**Fields:**
- All fields are optional

---

### DELETE `/api/v1/campaigns/:id`
**Description:** Delete campaign (Brand Owner only)

**Request Body:** None

**URL Parameters:**
- `id` (required) - Campaign UUID

---

## Application Routes (`/api/v1/applications`)

### POST `/api/v1/applications`
**Description:** Apply to a campaign (Influencer only)

**Request Body:**
```json
{
  "campaignId": "string (required)" // Valid UUID
}
```

**Fields:**
- `campaignId` (required) - Campaign UUID

---

### POST `/api/v1/applications/:id/accept`
**Description:** Accept an application (Brand Owner only)

**Request Body:**
```json
{
  "agreedAmount": "number (required)",         // Non-negative number
  "platformFeePercent": "number (required)",   // Float between 0-100
  "requiresScript": "boolean (optional)"
}
```

**URL Parameters:**
- `id` (required) - Application UUID

**Fields:**
- `agreedAmount` (required) - Non-negative number
- `platformFeePercent` (required) - Float between 0-100
- `requiresScript` (optional) - Boolean

---

### POST `/api/v1/applications/bulk-accept`
**Description:** Accept multiple applications at once (Brand Owner only)

**Request Body:**
```json
{
  "campaignId": "string (required)",           // Valid UUID
  "applications": [                            // Array of objects (min 1 item)
    {
      "applicationId": "string (required)",    // Valid UUID
      "agreedAmount": "number (required)",     // Non-negative number
      "platformFeePercent": "number (required)", // Float between 0-100
      "requiresScript": "boolean (optional)"   // Boolean
    }
  ]
}
```

**Fields:**
- `campaignId` (required) - Campaign UUID
- `applications` (required) - Array with at least one item
  - `applicationId` (required) - Application UUID
  - `agreedAmount` (required) - Non-negative number
  - `platformFeePercent` (required) - Float between 0-100
  - `requiresScript` (optional) - Boolean

---

### POST `/api/v1/applications/:id/cancel`
**Description:** Cancel an application

**Request Body:** None

**URL Parameters:**
- `id` (required) - Application UUID

---

### POST `/api/v1/applications/:id/complete`
**Description:** Complete an application (Admin only)

**Request Body:** None

**URL Parameters:**
- `id` (required) - Application UUID

---

## Chat Routes (`/api/v1/chat`)

### GET `/api/v1/chat/:applicationId/history`
**Description:** Get chat history for an application

**Request Body:** None

**URL Parameters:**
- `applicationId` (required) - Application UUID

**Query Parameters:**
- `limit` (optional) - Number of messages (default: 50, max: 100)
- `offset` (optional) - Offset for pagination (default: 0)

---

### POST `/api/v1/chat/:applicationId`
**Description:** Create a chat for an application

**Request Body:** None

**URL Parameters:**
- `applicationId` (required) - Application UUID

---

### GET `/api/v1/chat/:applicationId`
**Description:** Get chat details for an application

**Request Body:** None

**URL Parameters:**
- `applicationId` (required) - Application UUID

---

## User Routes (`/api/v1/users`)

### GET `/api/v1/users/me`
**Description:** Get current user details with all related data

**Request Body:** None

---

## Plan Routes (`/api/v1/plans`)

### GET `/api/v1/plans`
**Description:** Get all active plans (Brand Owner and Admin)

**Request Body:** None

---

### POST `/api/v1/plans`
**Description:** Create a new plan (Admin only)

**Request Body:**
```json
{
  "name": "string (required)",              // 1-200 characters
  "features": "object (optional)",          // Object
  "price": "number (required)",             // Non-negative number
  "billing_cycle": "string (required)",     // "MONTHLY" or "YEARLY"
  "is_active": "boolean (optional)"
}
```

**Fields:**
- `name` (required) - Plan name, 1-200 characters
- `price` (required) - Non-negative number
- `billing_cycle` (required) - "MONTHLY" or "YEARLY"
- `features` (optional) - Object
- `is_active` (optional) - Boolean

---

### PUT `/api/v1/plans/:id`
**Description:** Update a plan (Admin only)

**Request Body:**
```json
{
  "name": "string (optional)",              // 1-200 characters
  "features": "object (optional)",          // Object
  "price": "number (optional)",             // Non-negative number
  "billing_cycle": "string (optional)",     // "MONTHLY" or "YEARLY"
  "is_active": "boolean (optional)"
}
```

**URL Parameters:**
- `id` (required) - Plan UUID

**Fields:**
- All fields are optional

---

## Subscription Routes (`/api/v1/subscriptions`)

### POST `/api/v1/subscriptions`
**Description:** Create a new subscription for authenticated brand user (Brand Owner only)

**Request Body:**
```json
{
  "plan_id": "string (required)",      // Plan UUID
  "is_auto_renew": "boolean (optional)"
}
```

**Fields:**
- `plan_id` (required) - Plan UUID
- `is_auto_renew` (optional) - Boolean

---

### GET `/api/v1/subscriptions/all`
**Description:** Get all subscriptions (Admin only)

**Request Body:** None

---

### GET `/api/v1/subscriptions/current/:userId`
**Description:** Get current subscription for any brand (Admin only)

**Request Body:** None

**URL Parameters:**
- `userId` (required) - User UUID

---

### DELETE `/api/v1/subscriptions`
**Description:** Cancel subscription for authenticated brand user (Brand Owner only)

**Request Body:** None

---

### DELETE `/api/v1/subscriptions/:userId`
**Description:** Cancel subscription for any brand (Admin only)

**Request Body:** None

**URL Parameters:**
- `userId` (required) - User UUID

---

## Payment Routes (`/api/v1/payments`)

### GET `/api/v1/payments/config`
**Description:** Get payment config (Razorpay key)

**Request Body:** None

---

### POST `/api/v1/payments/applications/:applicationId`
**Description:** Create payment order for application (Brand pays admin after application completion)

**Request Body:** None

**URL Parameters:**
- `applicationId` (required) - Application UUID

---

### POST `/api/v1/payments/verify`
**Description:** Verify payment (Brand and Admin)

**Request Body:**
```json
{
  "razorpay_order_id": "string (required)",
  "razorpay_payment_id": "string (required)",
  "razorpay_signature": "string (required)",
  "application_id": "string (required)"  // Valid UUID
}
```

**Fields:**
- `razorpay_order_id` (required) - String
- `razorpay_payment_id` (required) - String
- `razorpay_signature` (required) - String
- `application_id` (required) - Application UUID

---

### POST `/api/v1/payments/applications/:applicationId/release`
**Description:** Release payout to influencer (Admin only)

**Request Body:** None

**URL Parameters:**
- `applicationId` (required) - Application UUID

---

### GET `/api/v1/payments/applications/:applicationId`
**Description:** Get payments for an application (Brand, Influencer, Admin)

**Request Body:** None

**URL Parameters:**
- `applicationId` (required) - Application UUID

---

## Authentication Requirements

Most endpoints require authentication via Bearer token in the Authorization header:
```
Authorization: Bearer <token>
```

Roles are enforced for certain endpoints:
- **INFLUENCER** - Influencer-specific endpoints
- **BRAND_OWNER** - Brand owner-specific endpoints
- **ADMIN** - Admin-only endpoints

Some endpoints allow multiple roles (e.g., `["BRAND_OWNER", "ADMIN"]`).

