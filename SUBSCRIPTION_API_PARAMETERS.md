# Subscription API Parameters Guide

## Error Analysis: Common Issues and Solutions

### Issue 1: Receipt Length Error
**Error:** `receipt: the length must be no more than 40`

**Problem:**
- Original receipt format: `sub_${userId}_${Date.now()}`
- UUID length: 36 characters
- Timestamp length: 13 characters  
- Prefix length: 4 characters
- Total length: ~53 characters
- **RazorPay limit: 40 characters**

**Solution:**
Changed receipt format to: `sub_${Date.now()}` (17 characters)

### Issue 2: calculateEndDate Undefined Error
**Error:** `Cannot read properties of undefined (reading 'calculateEndDate')`

**Problem:**
- `this.calculateEndDate` was called in async context where `this` is not bound
- Method was not accessible from the class instance

**Solution:**
- Made `calculateEndDate` method static
- Changed calls from `this.calculateEndDate()` to `SubscriptionController.calculateEndDate()`
- Also fixed similar issues with webhook handler methods

## Complete API Parameters Reference

### 1. GET /api/subscriptions/plans
**Authentication:** Not required  
**Parameters:** None  
**Description:** Get all active subscription plans

**Response Parameters:**
- `success` (boolean): Request status
- `plans` (array): Array of plan objects
  - `id` (string): Plan identifier
  - `name` (string): Plan display name
  - `price` (string): Plan price in INR
  - `period` (string): Subscription duration
  - `description` (string): Plan description
  - `highlight` (boolean): Whether plan is highlighted
  - `is_active` (boolean): Whether plan is available

### 2. GET /api/subscriptions/payment-config
**Authentication:** Not required  
**Parameters:** None  
**Description:** Get RazorPay configuration

**Response Parameters:**
- `success` (boolean): Request status
- `config` (object): Payment configuration
  - `key_id` (string): RazorPay public key
  - `currency` (string): Payment currency (INR)

### 3. POST /api/subscriptions/create-order
**Authentication:** Required (Bearer Token)  
**Description:** Create RazorPay order for subscription

**Request Parameters:**
```json
{
  "plan_id": "1month"
}
```

**Required Parameters:**
- `plan_id` (string): Plan identifier
  - Valid values: "10days", "1month", "3months", "6months", "1year"
  - Must be an active plan

**Validation Rules:**
- User must be authenticated
- Plan ID must exist and be active
- User cannot have existing active subscription
- RazorPay must be configured

**Response Parameters:**
- `success` (boolean): Request status
- `order` (object): RazorPay order details
  - `id` (string): RazorPay order ID
  - `amount` (number): Amount in paise
  - `currency` (string): Currency code
  - `receipt` (string): Order receipt (max 40 chars)
- `subscription` (object): Created subscription record
  - `id` (string): Subscription UUID
  - `plan_id` (string): Selected plan ID
  - `status` (string): Subscription status ("pending")
  - `amount_paid` (number): Plan price
- `plan` (object): Plan details

### 4. POST /api/subscriptions/process-payment
**Authentication:** Required (Bearer Token)  
**Description:** Process payment and activate subscription

**Request Parameters:**
```json
{
  "order_id": "order_xxxxxxxxxxxxx",
  "payment_id": "pay_xxxxxxxxxxxxx", 
  "signature": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

**Required Parameters:**
- `order_id` (string): RazorPay order ID from create-order
- `payment_id` (string): RazorPay payment ID from gateway
- `signature` (string): RazorPay signature for verification

**Validation Rules:**
- User must be authenticated
- Order must exist and belong to user
- Payment must be verified with RazorPay
- Signature must be valid

**Response Parameters:**
- `success` (boolean): Request status
- `message` (string): Success message
- `subscription` (object): Updated subscription
  - `id` (string): Subscription UUID
  - `plan_id` (string): Plan ID
  - `status` (string): Status ("active")
  - `start_date` (string): Subscription start date
  - `end_date` (string): Subscription end date
  - `amount_paid` (number): Amount paid

### 5. GET /api/subscriptions/status
**Authentication:** Required (Bearer Token)  
**Parameters:** None  
**Description:** Get current subscription status

**Response Parameters:**
- `success` (boolean): Request status
- `subscription` (object): Subscription data
  - `has_active_subscription` (boolean): Whether user has active subscription
  - `subscription` (object|null): Active subscription details
    - `id` (string): Subscription UUID
    - `plan_id` (string): Plan ID
    - `plan_name` (string): Plan display name
    - `status` (string): Subscription status
    - `start_date` (string): Start date
    - `end_date` (string): End date
    - `amount_paid` (number): Amount paid

### 6. GET /api/subscriptions/payment-status/:payment_id
**Authentication:** Required (Bearer Token)  
**Description:** Get payment status for specific payment

**Path Parameters:**
- `payment_id` (string): RazorPay payment ID

**Response Parameters:**
- `success` (boolean): Request status
- `payment` (object): Payment details
  - `id` (string): Payment ID
  - `status` (string): Payment status
  - `amount` (number): Amount in paise
  - `currency` (string): Currency
  - `method` (string): Payment method
  - `created_at` (number): Payment timestamp
- `subscription` (object): Associated subscription

### 7. POST /api/subscriptions/cancel
**Authentication:** Required (Bearer Token)  
**Parameters:** None  
**Description:** Cancel active subscription

**Validation Rules:**
- User must be authenticated
- User must have active subscription

**Response Parameters:**
- `success` (boolean): Request status
- `subscription` (object): Updated subscription
  - `id` (string): Subscription UUID
  - `plan_id` (string): Plan ID
  - `status` (string): Status ("cancelled")
  - `end_date` (string): Updated end date
- `message` (string): Success message

### 8. GET /api/subscriptions/history
**Authentication:** Required (Bearer Token)  
**Description:** Get subscription history

**Query Parameters:**
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 10)

**Response Parameters:**
- `success` (boolean): Request status
- `subscriptions` (array): Subscription history
  - `id` (string): Subscription UUID
  - `plan_id` (string): Plan ID
  - `status` (string): Subscription status
  - `start_date` (string): Start date
  - `end_date` (string): End date
  - `amount_paid` (number): Amount paid
  - `created_at` (string): Creation date
  - `plans` (object): Plan details
- `pagination` (object): Pagination info
  - `page` (number): Current page
  - `limit` (number): Items per page
  - `total` (number): Total items
  - `pages` (number): Total pages

## Common Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Plan ID is required"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Authentication required"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Internal server error"
}
```

## RazorPay Integration Notes

### Receipt Format
- **Format:** `sub_${timestamp}`
- **Example:** `sub_1705312200000`
- **Length:** ~17 characters
- **Limit:** 40 characters (RazorPay requirement)

### Amount Format
- **Backend:** Stored in paise (multiply by 100)
- **Example:** ₹499 → 49900 paise
- **Frontend:** Display in rupees

### Signature Verification
- RazorPay provides signature for payment verification
- Backend verifies signature before processing payment
- Prevents payment tampering

## Testing Parameters

### Test Plan IDs
- `10days` - 10 Days Trial
- `1month` - 1 Month
- `3months` - 3 Months
- `6months` - 6 Months
- `1year` - 1 Year

### Test Payment Details
- **Card:** 4111 1111 1111 1111
- **Expiry:** Any future date
- **CVV:** Any 3 digits
- **OTP:** 123456
