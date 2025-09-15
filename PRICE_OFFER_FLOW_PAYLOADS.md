# 💰 Price Offer Flow - Complete Payload Documentation

## 📋 Overview

This document provides comprehensive payload specifications for all price offer flow actions in the automated conversation system. Each action has specific payload requirements and response structures.

---

## 🎯 **Brand Owner Actions**

### **1. Send Price Offer**

**Endpoint:** `POST /api/bids/automated/brand-owner-action`  
**Action:** `send_price_offer`

#### **Request Payload:**
```json
{
  "conversation_id": "uuid",
  "action": "send_price_offer",
  "data": {
    "price": 1500
  }
}
```

#### **Required Fields:**
- `conversation_id` (string, UUID) - The conversation ID
- `action` (string) - Must be "send_price_offer"
- `data.price` (number) - The price amount in INR

#### **Response:**
```json
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "flow_state": "influencer_price_response",
    "awaiting_role": "influencer"
  },
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "brand_owner_uuid",
    "receiver_id": "influencer_uuid",
    "message": "💰 **Price Offer**\n\nBrand owner has offered: **₹1500**\n\nPlease review and respond to this offer.",
    "message_type": "automated",
    "action_required": true,
    "action_data": {
      "title": "🎯 **Price Offer Response**",
      "subtitle": "Choose how you'd like to respond to this price offer:",
      "buttons": [
        {
          "id": "accept_price",
          "text": "Accept Offer",
          "style": "success",
          "action": "accept_price"
        },
        {
          "id": "reject_price",
          "text": "Reject Offer",
          "style": "danger",
          "action": "reject_price"
        },
        {
          "id": "negotiate_price",
          "text": "Negotiate Price",
          "style": "warning",
          "action": "negotiate_price"
        }
      ]
    }
  },
  "audit_message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "system_uuid",
    "receiver_id": "brand_owner_uuid",
    "message": "✅ **Action Taken: Price Offer Sent**\n\nYou have offered ₹1500 to the influencer.",
    "message_type": "audit",
    "action_required": false
  }
}
```

#### **Flow Data Updates:**
```json
{
  "price_offer": 1500,
  "offer_timestamp": "2025-01-03T10:00:00Z"
}
```

---

### **2. Send Negotiated Price**

**Endpoint:** `POST /api/bids/automated/brand-owner-action`  
**Action:** `send_negotiated_price`

#### **Request Payload:**
```json
{
  "conversation_id": "uuid",
  "action": "send_negotiated_price",
  "data": {
    "price": 1200
  }
}
```

#### **Required Fields:**
- `conversation_id` (string, UUID) - The conversation ID
- `action` (string) - Must be "send_negotiated_price"
- `data.price` (number) - The negotiated price amount in INR

#### **Response:**
```json
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "flow_state": "influencer_final_response",
    "awaiting_role": "influencer"
  },
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "brand_owner_uuid",
    "receiver_id": "influencer_uuid",
    "message": "💰 **Negotiated Price Offer**\n\nBrand owner has offered a new price: **₹1200**\n\nThis is negotiation round 1/3.",
    "message_type": "automated",
    "action_required": true,
    "action_data": {
      "title": "🎯 **Final Price Response**",
      "subtitle": "This is your final chance to respond to the price offer:",
      "buttons": [
        {
          "id": "accept_negotiated_price",
          "text": "Accept Offer",
          "style": "success",
          "action": "accept_negotiated_price"
        },
        {
          "id": "reject_negotiated_price",
          "text": "Reject Offer",
          "style": "danger",
          "action": "reject_negotiated_price"
        }
      ]
    }
  },
  "audit_message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "system_uuid",
    "receiver_id": "brand_owner_uuid",
    "message": "✅ **Action Taken: Negotiated Price Sent**\n\nYou have sent a new price offer: ₹1200",
    "message_type": "audit",
    "action_required": false
  }
}
```

#### **Flow Data Updates:**
```json
{
  "negotiated_price": 1200,
  "negotiation_count": 1,
  "negotiation_timestamp": "2025-01-03T10:30:00Z"
}
```

---

### **3. Proceed to Payment**

**Endpoint:** `POST /api/bids/automated/brand-owner-action`  
**Action:** `proceed_to_payment`

#### **Request Payload:**
```json
{
  "conversation_id": "uuid",
  "action": "proceed_to_payment",
  "data": {}
}
```

#### **Required Fields:**
- `conversation_id` (string, UUID) - The conversation ID
- `action` (string) - Must be "proceed_to_payment"
- `data` (object) - Can be empty

#### **Response:**
```json
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "flow_state": "payment_pending",
    "awaiting_role": null
  },
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "brand_owner_uuid",
    "receiver_id": "influencer_uuid",
    "message": "💳 **Payment Initiated**\n\nPayment order has been created for **₹1200**.\n\nOrder ID: `order_1234567890`\n\nPlease complete the payment to finalize the collaboration.",
    "message_type": "automated",
    "action_required": false,
    "action_data": {
      "payment_order": {
        "id": "transaction_uuid",
        "razorpay_order_id": "order_1234567890",
        "amount": 1200,
        "currency": "INR",
        "razorpay_config": {
          "key_id": "rzp_test_1234567890",
          "amount": 120000,
          "currency": "INR",
          "order_id": "order_1234567890",
          "name": "Stoory Collaboration",
          "description": "Payment for bid collaboration - ₹1200"
        }
      }
    }
  },
  "audit_message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "system_uuid",
    "receiver_id": "brand_owner_uuid",
    "message": "✅ **Action Taken: Payment Initiated**\n\nPayment order has been created successfully.",
    "message_type": "audit",
    "action_required": false
  }
}
```

#### **Database Changes:**
- Creates transaction record in `transactions` table
- Updates conversation flow_state to "payment_pending"
- Creates Razorpay order

---

## 🎯 **Influencer Actions**

### **1. Accept Price Offer**

**Endpoint:** `POST /api/bids/automated/influencer-action`  
**Action:** `accept_price`

#### **Request Payload:**
```json
{
  "conversation_id": "uuid",
  "action": "accept_price",
  "data": {}
}
```

#### **Required Fields:**
- `conversation_id` (string, UUID) - The conversation ID
- `action` (string) - Must be "accept_price"
- `data` (object) - Can be empty

#### **Response:**
```json
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "flow_state": "payment_pending",
    "awaiting_role": "brand_owner"
  },
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "influencer_uuid",
    "receiver_id": "brand_owner_uuid",
    "message": "✅ **Price Offer Accepted**\n\nInfluencer has agreed to the offer. Please proceed with payment to complete the collaboration.",
    "message_type": "automated",
    "action_required": true,
    "action_data": {
      "title": "🎯 **Payment Required**",
      "subtitle": "Complete the payment to finalize the collaboration:",
      "buttons": [
        {
          "id": "proceed_to_payment",
          "text": "Proceed to Payment",
          "style": "success",
          "action": "proceed_to_payment"
        }
      ]
    }
  },
  "audit_message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "system_uuid",
    "receiver_id": "influencer_uuid",
    "message": "✅ **Action Taken: Price Offer Accepted**\n\nYou have accepted the price offer from the brand owner.",
    "message_type": "audit",
    "action_required": false
  }
}
```

#### **Flow Data Updates:**
```json
{
  "agreed_amount": 1500,
  "agreement_timestamp": "2025-01-03T10:15:00Z"
}
```

---

### **2. Reject Price Offer**

**Endpoint:** `POST /api/bids/automated/influencer-action`  
**Action:** `reject_price`

#### **Request Payload:**
```json
{
  "conversation_id": "uuid",
  "action": "reject_price",
  "data": {}
}
```

#### **Required Fields:**
- `conversation_id` (string, UUID) - The conversation ID
- `action` (string) - Must be "reject_price"
- `data` (object) - Can be empty

#### **Response:**
```json
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "flow_state": "chat_closed",
    "awaiting_role": null
  },
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "influencer_uuid",
    "receiver_id": "brand_owner_uuid",
    "message": "❌ **Price Offer Rejected**\n\nInfluencer has rejected the price offer. The conversation has been closed.",
    "message_type": "automated",
    "action_required": false
  },
  "audit_message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "system_uuid",
    "receiver_id": "influencer_uuid",
    "message": "✅ **Action Taken: Price Offer Rejected**\n\nYou have rejected the price offer from the brand owner.",
    "message_type": "audit",
    "action_required": false
  }
}
```

---

### **3. Negotiate Price**

**Endpoint:** `POST /api/bids/automated/influencer-action`  
**Action:** `negotiate_price`

#### **Request Payload:**
```json
{
  "conversation_id": "uuid",
  "action": "negotiate_price",
  "data": {}
}
```

#### **Required Fields:**
- `conversation_id` (string, UUID) - The conversation ID
- `action` (string) - Must be "negotiate_price"
- `data` (object) - Can be empty

#### **Response:**
```json
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "flow_state": "brand_owner_negotiation",
    "awaiting_role": "brand_owner"
  },
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "influencer_uuid",
    "receiver_id": "brand_owner_uuid",
    "message": "🤝 **Price Negotiation Requested**\n\nInfluencer wants to negotiate the price. Please provide a new offer.",
    "message_type": "automated",
    "action_required": true,
    "action_data": {
      "title": "🎯 **Price Negotiation**",
      "subtitle": "Enter a new price offer for negotiation:",
      "input_field": {
        "id": "negotiated_price",
        "type": "number",
        "placeholder": "Enter negotiated price amount in INR",
        "required": true,
        "min": 1
      },
      "submit_button": {
        "text": "Send Negotiated Price",
        "style": "success"
      }
    }
  },
  "audit_message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "system_uuid",
    "receiver_id": "influencer_uuid",
    "message": "✅ **Action Taken: Price Negotiation Requested**\n\nYou have requested to negotiate the price offer.",
    "message_type": "audit",
    "action_required": false
  }
}
```

---

### **4. Accept Negotiated Price**

**Endpoint:** `POST /api/bids/automated/influencer-action`  
**Action:** `accept_negotiated_price`

#### **Request Payload:**
```json
{
  "conversation_id": "uuid",
  "action": "accept_negotiated_price",
  "data": {}
}
```

#### **Required Fields:**
- `conversation_id` (string, UUID) - The conversation ID
- `action` (string) - Must be "accept_negotiated_price"
- `data` (object) - Can be empty

#### **Response:**
```json
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "flow_state": "payment_pending",
    "awaiting_role": "brand_owner"
  },
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "influencer_uuid",
    "receiver_id": "brand_owner_uuid",
    "message": "✅ **Price Offer Accepted**\n\nInfluencer has agreed to the negotiated offer. Please proceed with payment to complete the collaboration.",
    "message_type": "automated",
    "action_required": true,
    "action_data": {
      "title": "🎯 **Payment Required**",
      "subtitle": "Complete the payment to finalize the collaboration:",
      "buttons": [
        {
          "id": "proceed_to_payment",
          "text": "Proceed to Payment",
          "style": "success",
          "action": "proceed_to_payment"
        }
      ]
    }
  },
  "audit_message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "system_uuid",
    "receiver_id": "influencer_uuid",
    "message": "✅ **Action Taken: Negotiated Price Accepted**\n\nYou have accepted the negotiated price offer.",
    "message_type": "audit",
    "action_required": false
  }
}
```

#### **Flow Data Updates:**
```json
{
  "agreed_amount": 1200,
  "agreement_timestamp": "2025-01-03T10:45:00Z"
}
```

---

## 📊 **Flow Data Structure**

The conversation's `flow_data` field stores all price-related information:

```json
{
  "proposed_amount": 1000,
  "price_offer": 1500,
  "offer_timestamp": "2025-01-03T10:00:00Z",
  "negotiated_price": 1200,
  "negotiation_count": 1,
  "negotiation_timestamp": "2025-01-03T10:30:00Z",
  "agreed_amount": 1200,
  "agreement_timestamp": "2025-01-03T10:45:00Z"
}
```

### **Field Descriptions:**
- `proposed_amount` - Initial amount proposed by influencer
- `price_offer` - Price offered by brand owner
- `offer_timestamp` - When the price offer was made
- `negotiated_price` - Price after negotiation
- `negotiation_count` - Number of negotiation rounds
- `negotiation_timestamp` - When negotiation occurred
- `agreed_amount` - Final agreed amount for payment
- `agreement_timestamp` - When agreement was reached

---

## 🔄 **Flow State Transitions**

```
influencer_responding → brand_owner_pricing → influencer_price_response
                                    ↓
                              brand_owner_negotiation → influencer_final_response
                                    ↓
                              payment_pending → payment_completed
```

---

## ⚠️ **Error Handling**

### **Common Error Responses:**

#### **Invalid Action:**
```json
{
  "success": false,
  "message": "Failed to handle action",
  "error": "Unknown action: invalid_action"
}
```

#### **Missing Required Fields:**
```json
{
  "success": false,
  "message": "Missing required parameters"
}
```

#### **Invalid Price:**
```json
{
  "success": false,
  "message": "Failed to handle action",
  "error": "Price must be a positive number"
}
```

#### **Payment Creation Failed:**
```json
{
  "success": false,
  "message": "Failed to handle action",
  "error": "Failed to create transaction: [database error]"
}
```

---

## 🧪 **Testing Examples**

### **Complete Price Offer Flow:**

1. **Brand Owner sends price offer:**
```bash
curl -X POST /api/bids/automated/brand-owner-action \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "uuid",
    "action": "send_price_offer",
    "data": {"price": 1500}
  }'
```

2. **Influencer accepts offer:**
```bash
curl -X POST /api/bids/automated/influencer-action \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "uuid",
    "action": "accept_price",
    "data": {}
  }'
```

3. **Brand Owner proceeds to payment:**
```bash
curl -X POST /api/bids/automated/brand-owner-action \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "uuid",
    "action": "proceed_to_payment",
    "data": {}
  }'
```

---

## 📝 **Notes**

- All amounts are in INR (Indian Rupees)
- Timestamps are in ISO 8601 format
- UUIDs are standard UUID v4 format
- All actions require proper authentication
- Flow state transitions are automatic based on actions
- Payment integration uses Razorpay
- Transaction records are created in the `transactions` table
