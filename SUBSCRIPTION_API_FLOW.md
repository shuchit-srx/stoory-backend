# Subscription API Flow Documentation

## Overview
This document describes the complete subscription flow for brand owners to access premium features on the Stoory platform. The flow involves plan selection, payment processing via RazorPay, and subscription management.

## Available Plans
The system offers 5 subscription plans:

| Plan ID | Name | Price (INR) | Period | Description |
|---------|------|-------------|--------|-------------|
| `10days` | 10 Days Trial | ₹199 | 10 days | Short-term access for quick needs |
| `1month` | 1 Month | ₹499 | 1 month | Best for trying out all features |
| `3months` | 3 Months | ₹1,200 | 3 months | Save more with a quarterly plan |
| `6months` | 6 Months | ₹2,500 | 6 months | Half-year access at a great value |
| `1year` | 1 Year | ₹4,999 | 1 year | Best value for long-term users |

## API Endpoints Flow

### 1. Get Available Plans
**Endpoint:** `GET /api/subscriptions/plans`  
**Authentication:** Not required (Public)  
**Description:** Retrieves all active subscription plans

**Response:**
```json
{
  "success": true,
  "plans": [
    {
      "id": "10days",
      "name": "10 Days Trial",
      "price": "199.00",
      "period": "10 days",
      "description": "Short-term access for quick needs",
      "highlight": false,
      "is_active": true
    },
    {
      "id": "1month",
      "name": "1 Month",
      "price": "499.00",
      "period": "1 month",
      "description": "Best for trying out all features",
      "highlight": false,
      "is_active": true
    }
    // ... more plans
  ]
}
```

### 2. Get Payment Configuration
**Endpoint:** `GET /api/subscriptions/payment-config`  
**Authentication:** Not required (Public)  
**Description:** Returns RazorPay configuration for frontend integration

**Response:**
```json
{
  "success": true,
  "config": {
    "key_id": "rzp_test_xxxxxxxxxxxxx",
    "currency": "INR"
  }
}
```

### 3. Create Subscription Order
**Endpoint:** `POST /api/subscriptions/create-order`  
**Authentication:** Required (Bearer Token)  
**Description:** Creates a RazorPay order for subscription payment

**Request Body:**
```json
{
  "plan_id": "1month"
}
```

**Required Parameters:**
- `plan_id` (string): The ID of the selected plan (e.g., "10days", "1month", "3months", "6months", "1year")

**Validation Rules:**
- User must be authenticated
- Plan ID must be valid and active
- User cannot have an existing active subscription
- RazorPay must be configured

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "order_xxxxxxxxxxxxx",
    "amount": 49900,
    "currency": "INR",
    "receipt": "receipt_xxxxxxxxxxxxx",
    "status": "created"
  },
  "subscription": {
    "id": "sub_xxxxxxxxxxxxx",
    "plan_id": "1month",
    "amount": 499.00,
    "status": "pending"
  }
}
```

### 4. Process Subscription Payment
**Endpoint:** `POST /api/subscriptions/process-payment`  
**Authentication:** Required (Bearer Token)  
**Description:** Processes the payment and activates the subscription

**Request Body:**
```json
{
  "order_id": "order_xxxxxxxxxxxxx",
  "payment_id": "pay_xxxxxxxxxxxxx",
  "signature": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

**Required Parameters:**
- `order_id` (string): RazorPay order ID received from create-order endpoint
- `payment_id` (string): RazorPay payment ID received from payment gateway
- `signature` (string): RazorPay signature for payment verification

**Validation Rules:**
- User must be authenticated
- Order must exist and belong to the user
- Payment must be verified with RazorPay
- Signature must be valid

**Response:**
```json
{
  "success": true,
  "message": "Payment processed successfully",
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "1month",
    "status": "active",
    "start_date": "2024-01-15T10:30:00Z",
    "end_date": "2024-02-15T10:30:00Z",
    "amount_paid": 499.00
  }
}
```

### 5. Get Subscription Status
**Endpoint:** `GET /api/subscriptions/status`  
**Authentication:** Required (Bearer Token)  
**Description:** Returns current subscription status for the user

**Response:**
```json
{
  "success": true,
  "subscription": {
    "has_active_subscription": true,
    "subscription": {
      "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "plan_id": "1month",
      "plan_name": "1 Month",
      "status": "active",
      "start_date": "2024-01-15T10:30:00Z",
      "end_date": "2024-02-15T10:30:00Z",
      "amount_paid": 499.00
    }
  }
}
```

### 6. Get Payment Status
**Endpoint:** `GET /api/subscriptions/payment-status/:payment_id`  
**Authentication:** Required (Bearer Token)  
**Description:** Returns detailed payment status for a specific payment

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pay_xxxxxxxxxxxxx",
    "status": "captured",
    "amount": 49900,
    "currency": "INR",
    "method": "card",
    "created_at": 1705312200
  },
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "1month",
    "status": "active",
    "amount_paid": 499.00
  }
}
```

### 7. Cancel Subscription
**Endpoint:** `POST /api/subscriptions/cancel`  
**Authentication:** Required (Bearer Token)  
**Description:** Cancels the current active subscription

**Response:**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "1month",
    "status": "cancelled",
    "end_date": "2024-01-20T10:30:00Z"
  },
  "message": "Subscription cancelled successfully"
}
```

### 8. Get Subscription History
**Endpoint:** `GET /api/subscriptions/history`  
**Authentication:** Required (Bearer Token)  
**Description:** Returns paginated subscription history

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)

**Response:**
```json
{
  "success": true,
  "subscriptions": [
    {
      "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "plan_id": "1month",
      "status": "active",
      "start_date": "2024-01-15T10:30:00Z",
      "end_date": "2024-02-15T10:30:00Z",
      "amount_paid": 499.00,
      "created_at": "2024-01-15T10:30:00Z",
      "plans": {
        "id": "1month",
        "name": "1 Month",
        "price": "499.00",
        "period": "1 month"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "pages": 1
  }
}
```

## Frontend Integration Flow

### Step 1: Plan Selection
1. Call `GET /api/subscriptions/plans` to display available plans
2. User selects a plan
3. Call `GET /api/subscriptions/payment-config` to get RazorPay configuration

### Step 2: Create Order
1. Call `POST /api/subscriptions/create-order` with selected `plan_id`
2. Backend creates RazorPay order and returns order details

### Step 3: RazorPay Integration
1. Initialize RazorPay with the configuration from step 1
2. Use the order details from step 2 to open RazorPay payment gateway
3. Handle payment success/failure callbacks

### Step 4: Payment Processing
1. On successful payment, call `POST /api/subscriptions/process-payment` with payment details
2. Backend verifies payment and activates subscription
3. Update UI to show active subscription

### Step 5: Subscription Management
1. Use `GET /api/subscriptions/status` to check current subscription
2. Use `GET /api/subscriptions/history` to show subscription history
3. Use `POST /api/subscriptions/cancel` to cancel subscription if needed

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description"
}
```

Common HTTP status codes:
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (missing/invalid token)
- `404` - Not Found (resource not found)
- `500` - Internal Server Error

## Webhook Handling

The system automatically handles RazorPay webhooks at `POST /api/subscriptions/webhook` to:
- Update subscription status on payment success
- Handle subscription activation/cancellation events
- Ensure data consistency between RazorPay and our database

## Security Features

1. **Authentication Required:** Most endpoints require valid JWT token
2. **Webhook Verification:** RazorPay webhooks are verified using signature
3. **Payment Verification:** All payments are verified with RazorPay before processing
4. **User Isolation:** Users can only access their own subscription data
5. **Grace Period:** 2-day grace period for expired subscriptions
