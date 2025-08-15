# 📋 **Complete Subscription API Documentation**

## **🔗 Base URL**
```
https://your-domain.com/api/subscriptions
```

---

## **📋 All Available Endpoints**

### **🌐 Public Endpoints (No Authentication Required)**

#### **1. GET /plans**
**Description:** Get all available subscription plans
- **Method:** GET
- **Authentication:** Not required
- **Response:** List of all active subscription plans

**Response Example:**
```json
{
  "success": true,
  "plans": [
    {
      "id": "1month",
      "name": "1 Month",
      "price": 499,
      "period": "1 month",
      "description": "Best for trying out all features",
      "highlight": false,
      "is_active": true
    },
    {
      "id": "3months",
      "name": "3 Months",
      "price": 1200,
      "period": "3 months",
      "description": "Save more with a quarterly plan",
      "highlight": false,
      "is_active": true
    },
    {
      "id": "6months",
      "name": "6 Months",
      "price": 2500,
      "period": "6 months",
      "description": "Best value for long-term users",
      "highlight": true,
      "is_active": true
    },
    {
      "id": "1year",
      "name": "1 Year",
      "price": 4999,
      "period": "1 year",
      "description": "Maximum savings with annual plan",
      "highlight": false,
      "is_active": true
    }
  ]
}
```

#### **2. GET /payment-config**
**Description:** Get RazorPay payment configuration
- **Method:** GET
- **Authentication:** Not required
- **Response:** RazorPay key and currency configuration

**Response Example:**
```json
{
  "success": true,
  "config": {
    "key_id": "rzp_test_xxxxxxxxxxxxx",
    "currency": "INR"
  }
}
```

#### **3. POST /webhook**
**Description:** Handle RazorPay webhook notifications
- **Method:** POST
- **Authentication:** Not required
- **Headers:** `x-razorpay-signature` (optional for development)
- **Body:** RazorPay webhook payload

**Request Example:**
```json
{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_xxxxxxxxxxxxx",
        "order_id": "order_xxxxxxxxxxxxx",
        "status": "captured",
        "amount": 499900,
        "currency": "INR"
      }
    }
  }
}
```

**Response Example:**
```json
{
  "success": true
}
```

---

### **🔐 Protected Endpoints (Authentication Required)**

#### **4. GET /status**
**Description:** Get current user's subscription status
- **Method:** GET
- **Authentication:** Required (Bearer Token)
- **Response:** Current subscription details or null if no active subscription

**Response Example (Active Subscription):**
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
      "start_date": "2025-08-15T14:30:38.654Z",
      "end_date": "2025-09-15T14:30:38.654Z",
      "amount_paid": 499
    }
  }
}
```

**Response Example (No Active Subscription):**
```json
{
  "success": true,
  "subscription": {
    "has_active_subscription": false,
    "subscription": null
  }
}
```

#### **5. POST /create-order**
**Description:** Create a new RazorPay order for subscription
- **Method:** POST
- **Authentication:** Required (Bearer Token)
- **Body:** Plan ID and optional parameters

**Request Example:**
```json
{
  "plan_id": "1month"
}
```

**Response Example (New Subscription):**
```json
{
  "success": true,
  "order": {
    "id": "order_xxxxxxxxxxxxx",
    "amount": 49900,
    "currency": "INR",
    "receipt": "sub_1755267591150"
  },
  "subscription_data": {
    "plan_id": "1month",
    "start_date": "2025-08-15T14:19:51.484Z",
    "end_date": "2025-09-15T14:19:51.484Z",
    "amount_paid": 499
  },
  "plan": {
    "id": "1month",
    "name": "1 Month",
    "price": 499,
    "period": "1 month",
    "description": "Best for trying out all features"
  }
}
```

**Response Example (Upgrade/Downgrade):**
```json
{
  "success": true,
  "order": {
    "id": "order_xxxxxxxxxxxxx",
    "amount": 120000,
    "currency": "INR",
    "receipt": "sub_1755267921248"
  },
  "subscription_data": {
    "plan_id": "3months",
    "start_date": "2025-08-15T14:25:21.509Z",
    "end_date": "2025-11-15T14:25:21.509Z",
    "amount_paid": 1200
  },
  "plan": {
    "id": "3months",
    "name": "3 Months",
    "price": 1200,
    "period": "3 months",
    "description": "Save more with a quarterly plan"
  },
  "existing_subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "1month",
    "status": "active",
    "amount_paid": 499
  },
  "is_upgrade": true
}
```

**Error Response (Same Plan):**
```json
{
  "success": false,
  "message": "You already have an active subscription for this plan"
}
```

#### **6. POST /process-payment**
**Description:** Process payment and create/update subscription
- **Method:** POST
- **Authentication:** Required (Bearer Token)
- **Body:** Payment details and subscription data

**Request Example:**
```json
{
  "razorpay_order_id": "order_xxxxxxxxxxxxx",
  "razorpay_payment_id": "pay_xxxxxxxxxxxxx",
  "razorpay_signature": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "plan_id": "1month",
  "start_date": "2025-08-15T14:19:51.484Z",
  "end_date": "2025-09-15T14:19:51.484Z",
  "amount_paid": 499
}
```

**Response Example (New Subscription):**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "user_id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "1month",
    "status": "active",
    "start_date": "2025-08-15T14:19:51.484Z",
    "end_date": "2025-09-15T14:19:51.484Z",
    "razorpay_payment_id": "pay_xxxxxxxxxxxxx",
    "amount_paid": 499,
    "created_at": "2025-08-15T14:19:51.484Z",
    "updated_at": "2025-08-15T14:19:51.484Z"
  },
  "message": "Payment processed successfully and subscription activated"
}
```

**Response Example (Upgrade/Downgrade):**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "user_id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "3months",
    "status": "active",
    "start_date": "2025-08-15T14:30:38.654Z",
    "end_date": "2025-12-15T14:30:38.654Z",
    "razorpay_payment_id": "pay_xxxxxxxxxxxxx",
    "amount_paid": 1200,
    "created_at": "2025-08-15T14:23:05.764Z",
    "updated_at": "2025-08-15T14:26:15.957Z"
  },
  "message": "Payment processed successfully and subscription activated"
}
```

#### **7. GET /payment-status/:payment_id**
**Description:** Get payment status from RazorPay
- **Method:** GET
- **Authentication:** Required (Bearer Token)
- **Parameters:** payment_id (in URL)
- **Response:** Payment details from RazorPay

**Response Example (Success):**
```json
{
  "success": true,
  "payment": {
    "id": "pay_xxxxxxxxxxxxx",
    "order_id": "order_xxxxxxxxxxxxx",
    "status": "captured",
    "amount": 49900,
    "currency": "INR",
    "method": "card",
    "created_at": 1755267591
  }
}
```

**Response Example (Payment Not Found):**
```json
{
  "success": false,
  "message": "Payment not found",
  "error": "The id provided does not exist"
}
```

#### **8. POST /update-payment-status**
**Description:** Manually update payment status (frontend fallback)
- **Method:** POST
- **Authentication:** Required (Bearer Token)
- **Body:** Payment details and status

**Request Example (Successful Payment):**
```json
{
  "order_id": "order_xxxxxxxxxxxxx",
  "payment_id": "pay_xxxxxxxxxxxxx",
  "status": "captured",
  "signature": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "plan_id": "1month",
  "start_date": "2025-08-15T14:19:51.484Z",
  "end_date": "2025-09-15T14:19:51.484Z",
  "amount_paid": 499
}
```

**Request Example (Failed Payment):**
```json
{
  "order_id": "order_xxxxxxxxxxxxx",
  "payment_id": "pay_xxxxxxxxxxxxx",
  "status": "failed",
  "reason": "timeout"
}
```

**Response Example (Successful Payment):**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "1month",
    "status": "active",
    "start_date": "2025-08-15T14:19:51.484Z",
    "end_date": "2025-09-15T14:19:51.484Z",
    "amount_paid": 499
  },
  "message": "Payment processed successfully and subscription activated"
}
```

**Response Example (Failed Payment):**
```json
{
  "success": true,
  "message": "Payment status updated to failed",
  "payment_status": "failed"
}
```

#### **9. POST /cancel**
**Description:** Cancel active subscription
- **Method:** POST
- **Authentication:** Required (Bearer Token)
- **Response:** Cancelled subscription details

**Response Example:**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "1month",
    "status": "cancelled",
    "start_date": "2025-08-15T14:19:51.484Z",
    "end_date": "2025-09-15T14:19:51.484Z",
    "amount_paid": 499,
    "updated_at": "2025-08-15T14:30:00.000Z"
  },
  "message": "Subscription cancelled successfully"
}
```

**Error Response (No Active Subscription):**
```json
{
  "success": false,
  "message": "No active subscription found"
}
```

#### **10. GET /history**
**Description:** Get subscription history with pagination
- **Method:** GET
- **Authentication:** Required (Bearer Token)
- **Query Parameters:** page (default: 1), limit (default: 10)
- **Response:** Paginated subscription history

**Request Example:**
```
GET /api/subscriptions/history?page=1&limit=5
```

**Response Example:**
```json
{
  "success": true,
  "subscriptions": [
    {
      "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "user_id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "plan_id": "1month",
      "status": "active",
      "start_date": "2025-08-15T14:19:51.484Z",
      "end_date": "2025-09-15T14:19:51.484Z",
      "razorpay_payment_id": "pay_xxxxxxxxxxxxx",
      "amount_paid": 499,
      "created_at": "2025-08-15T14:19:51.484Z",
      "updated_at": "2025-08-15T14:19:51.484Z",
      "plans": {
        "id": "1month",
        "name": "1 Month",
        "price": 499,
        "period": "1 month",
        "description": "Best for trying out all features"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  }
}
```

---

### **🧪 Test Endpoints (Development Only)**

#### **11. POST /test-create**
**Description:** Create test subscription (for testing only)
- **Method:** POST
- **Authentication:** Required (Bearer Token)
- **Body:** Plan ID
- **Response:** Test subscription details

**Request Example:**
```json
{
  "plan_id": "1month"
}
```

**Response Example:**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "user_id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "1month",
    "status": "active",
    "start_date": "2025-08-15T14:19:51.484Z",
    "end_date": "2025-09-15T14:19:51.484Z",
    "razorpay_payment_id": "test_payment_123",
    "amount_paid": 499,
    "created_at": "2025-08-15T14:19:51.484Z",
    "updated_at": "2025-08-15T14:19:51.484Z"
  },
  "message": "Test subscription created successfully"
}
```

#### **12. POST /test-payment**
**Description:** Process test payment (for testing only)
- **Method:** POST
- **Authentication:** Required (Bearer Token)
- **Body:** Plan ID and optional order ID
- **Response:** Test payment processing result

**Request Example:**
```json
{
  "plan_id": "3months"
}
```

**Response Example (New Subscription):**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "user_id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "3months",
    "status": "active",
    "start_date": "2025-08-15T14:19:51.484Z",
    "end_date": "2025-11-15T14:19:51.484Z",
    "razorpay_payment_id": "test_payment_1755267975815",
    "amount_paid": 1200,
    "created_at": "2025-08-15T14:19:51.484Z",
    "updated_at": "2025-08-15T14:19:51.484Z"
  },
  "message": "Test subscription created successfully"
}
```

**Response Example (Upgrade):**
```json
{
  "success": true,
  "subscription": {
    "id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "user_id": "uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan_id": "3months",
    "status": "active",
    "start_date": "2025-08-15T14:30:38.654Z",
    "end_date": "2025-12-15T14:30:38.654Z",
    "razorpay_payment_id": "test_payment_1755268645968",
    "amount_paid": 1200,
    "created_at": "2025-08-15T14:23:05.764Z",
    "updated_at": "2025-08-15T14:37:26.146Z"
  },
  "message": "Subscription upgraded successfully"
}
```

---

## **📊 Error Responses**

### **Common Error Formats:**

#### **400 Bad Request:**
```json
{
  "success": false,
  "message": "Missing required field: plan_id"
}
```

#### **401 Unauthorized:**
```json
{
  "success": false,
  "message": "Access token required"
}
```

#### **404 Not Found:**
```json
{
  "success": false,
  "message": "Payment not found",
  "error": "The id provided does not exist"
}
```

#### **500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Internal server error"
}
```

#### **503 Service Unavailable:**
```json
{
  "success": false,
  "message": "Payment service is not configured"
}
```

---

## **🔐 Authentication**

All protected endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## **📝 Notes**

1. **Time Extension Logic:** When upgrading/downgrading, the system extends the subscription time from the current end date, not resets it.

2. **No Pending Status:** The system doesn't create pending subscription records. Subscriptions are only created after successful payment.

3. **Webhook Processing:** RazorPay webhooks are automatically processed to update payment status.

4. **Test Endpoints:** Test endpoints are for development only and should not be used in production.

5. **Currency:** All amounts are in INR (Indian Rupees) and are handled in paise (smallest currency unit) by RazorPay.

6. **Signature Verification:** Payment signatures are verified for security. Webhook signatures are optional for development.

---

## **🔄 Complete Flow Example**

### **Frontend Integration Flow:**

```javascript
// 1. Get payment configuration
const config = await fetch('/api/subscriptions/payment-config');

// 2. Create order
const orderResponse = await fetch('/api/subscriptions/create-order', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ plan_id: '1month' })
});

// 3. Initialize RazorPay
const options = {
  key: config.key_id,
  amount: orderResponse.order.amount,
  currency: orderResponse.order.currency,
  order_id: orderResponse.order.id,
  handler: async function(response) {
    // 4. Process payment
    const paymentResponse = await fetch('/api/subscriptions/process-payment', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
        plan_id: '1month',
        start_date: orderResponse.subscription_data.start_date,
        end_date: orderResponse.subscription_data.end_date,
        amount_paid: orderResponse.subscription_data.amount_paid
      })
    });
    
    // 5. Check subscription status
    const statusResponse = await fetch('/api/subscriptions/status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  }
};

const rzp = new Razorpay(options);
rzp.open();
```

This completes the comprehensive API documentation for all subscription endpoints!

