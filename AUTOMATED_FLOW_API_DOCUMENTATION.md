# Automated Bid Flow API Documentation

## Overview
This document outlines the complete API endpoints for the automated bid flow system. The system handles the entire conversation flow from bid application to payment initiation through automated messages and user actions.

## Base URL
```
POST /api/bids/automated/*
```

## Authentication
All endpoints require a valid JWT token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

---

## 1. Initialize Automated Conversation

**Endpoint:** `POST /api/bids/automated/initialize`

**Description:** Initialize an automated conversation for a bid application. This creates the conversation and sends the first automated message to the brand owner.

**Required Role:** `brand_owner` or `admin`

**Request Body:**
```json
{
  "bid_id": "uuid",
  "influencer_id": "uuid", 
  "proposed_amount": 5000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Automated conversation initialized successfully",
  "conversation": {
    "id": "uuid",
    "bid_id": "uuid",
    "brand_owner_id": "uuid",
    "influencer_id": "uuid",
    "flow_state": "initial",
    "awaiting_role": "brand_owner",
    "chat_status": "automated",
    "flow_data": {
      "proposed_amount": 5000,
      "bid_title": "Product Promotion Campaign",
      "bid_description": "Promote our new product",
      "min_budget": 3000,
      "max_budget": 8000
    }
  },
  "flow_state": "initial",
  "awaiting_role": "brand_owner"
}
```

**Flow State:** `initial` → Brand owner sees action buttons

---

## 2. Handle Brand Owner Action

**Endpoint:** `POST /api/bids/automated/brand-owner-action`

**Description:** Handle the brand owner's response to the initial bid application. This processes their choice (accept, negotiate, ask questions) and updates the flow state.

**Required Role:** `brand_owner` or `admin`

**Request Body:**
```json
{
  "conversation_id": "uuid",
  "action": "accept_offer|negotiate_price|ask_questions",
  "data": {} // Optional additional data
}
```

**Available Actions:**
- `accept_offer`: Accept the influencer's proposed amount
- `negotiate_price`: Start price negotiation
- `ask_questions`: Ask questions to the influencer

**Response:**
```json
{
  "success": true,
  "message": "Action handled successfully",
  "conversation": {
    "flow_state": "influencer_responding|negotiating",
    "awaiting_role": "influencer|brand_owner"
  },
  "flow_state": "influencer_responding|negotiating",
  "awaiting_role": "influencer|brand_owner"
}
```

**Flow States:**
- `accept_offer` → `influencer_responding` (awaiting influencer)
- `negotiate_price` → `negotiating` (awaiting brand owner input)
- `ask_questions` → `negotiating` (awaiting brand owner input)

---

## 3. Handle Influencer Action

**Endpoint:** `POST /api/bids/automated/influencer-action`

**Description:** Handle the influencer's response to the brand owner's action. This processes their confirmation or rejection and updates the flow state.

**Required Role:** `influencer`

**Request Body:**
```json
{
  "conversation_id": "uuid",
  "action": "confirm_collaboration|reject_collaboration",
  "data": {} // Optional additional data
}
```

**Available Actions:**
- `confirm_collaboration`: Confirm the collaboration
- `reject_collaboration`: Reject the collaboration

**Response:**
```json
{
  "success": true,
  "message": "Action handled successfully",
  "conversation": {
    "flow_state": "brand_owner_confirming|declined",
    "awaiting_role": "brand_owner|null"
  },
  "flow_state": "brand_owner_confirming|declined",
  "awaiting_role": "brand_owner|null"
}
```

**Flow States:**
- `confirm_collaboration` → `brand_owner_confirming` (awaiting brand owner)
- `reject_collaboration` → `declined` (conversation closed)

---

## 4. Handle Final Confirmation

**Endpoint:** `POST /api/bids/automated/final-confirmation`

**Description:** Handle the brand owner's final confirmation to proceed to payment. This completes the automated flow and initiates payment.

**Required Role:** `brand_owner` or `admin`

**Request Body:**
```json
{
  "conversation_id": "uuid",
  "action": "proceed_to_payment|cancel_collaboration"
}
```

**Available Actions:**
- `proceed_to_payment`: Confirm and proceed to payment
- `cancel_collaboration`: Cancel the collaboration

**Response:**
```json
{
  "success": true,
  "message": "Final confirmation handled successfully",
  "flow_state": "payment_pending"
}
```

**Flow State:** `brand_owner_confirming` → `payment_pending`

---

## 5. Get Conversation Flow Context

**Endpoint:** `GET /api/bids/automated/conversation/:conversation_id/context`

**Description:** Get the current flow context and state of an automated conversation.

**Required Role:** `brand_owner`, `influencer`, or `admin`

**Response:**
```json
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "bid_id": "uuid",
    "brand_owner_id": "uuid",
    "influencer_id": "uuid",
    "flow_state": "initial",
    "awaiting_role": "brand_owner",
    "chat_status": "automated",
    "flow_data": {
      "proposed_amount": 5000,
      "bid_title": "Product Promotion Campaign"
    }
  },
  "flow_context": {
    "current_state": "initial",
    "awaiting_role": "brand_owner",
    "automation_enabled": true,
    "flow_data": {
      "proposed_amount": 5000,
      "bid_title": "Product Promotion Campaign"
    }
  }
}
```

---

## Complete Flow State Diagram

```
initial (awaiting brand_owner)
    ↓
brand_owner chooses action:
├── accept_offer → influencer_responding (awaiting influencer)
│   ↓
│   influencer responds:
│   ├── confirm_collaboration → brand_owner_confirming (awaiting brand_owner)
│   │   ↓
│   │   brand_owner confirms → payment_pending
│   └── reject_collaboration → declined (conversation closed)
│
├── negotiate_price → negotiating (awaiting brand_owner input)
│   ↓
│   brand_owner enters price → influencer_responding (awaiting influencer)
│   ↓
│   influencer responds → (same as above)
│
└── ask_questions → negotiating (awaiting brand_owner input)
    ↓
    brand_owner asks question → influencer_responding (awaiting influencer)
    ↓
    influencer responds → (same as above)
```

---

## Message Structure

### Automated Messages
All automated messages include:
- `message_type: "automated"`
- `action_required: true/false`
- `action_data`: Contains buttons, input fields, or other UI elements

### Action Data Examples

#### Button Actions
```json
{
  "buttons": [
    {
      "id": "accept_offer",
      "text": "Accept your offer",
      "style": "success",
      "action": "accept_offer"
    }
  ],
  "flow_state": "initial",
  "message_type": "brand_owner_initial",
  "visible_to": "brand_owner"
}
```

#### Input Field Actions
```json
{
  "input_field": {
    "type": "number",
    "placeholder": "Enter your proposed amount (e.g., 5000)",
    "required": true,
    "min": 0,
    "step": 100
  },
  "submit_button": {
    "text": "Submit Price",
    "style": "primary"
  },
  "flow_state": "negotiating",
  "message_type": "price_negotiation",
  "visible_to": "brand_owner"
}
```

---

## Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "success": false,
  "message": "conversation_id and action are required"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Only the brand owner can perform this action"
}
```

**400 Bad Request (Flow State):**
```json
{
  "success": false,
  "message": "Not your turn to respond"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Internal server error"
}
```

---

## Frontend Integration Guide

### 1. Initialize Conversation
When an influencer applies to a bid, call the initialize endpoint to start the automated flow.

### 2. Display Messages
- Show automated messages with action buttons or input fields
- Use `action_data` to render the appropriate UI components
- Check `awaiting_role` to determine whose turn it is

### 3. Handle User Actions
- Call the appropriate action endpoint when users interact
- Update the UI based on the response
- Handle flow state changes

### 4. Real-time Updates
- Listen for new messages via WebSocket
- Update conversation state when flow changes
- Disable actions when not the user's turn

### 5. Flow State Management
- Track current flow state and awaiting role
- Show appropriate UI based on state
- Handle transitions between states

---

## Testing

### Test Scenarios
1. **Complete Acceptance Flow:** Accept → Confirm → Payment
2. **Rejection Flow:** Accept → Reject → Closed
3. **Price Negotiation:** Negotiate → Counter → Accept → Confirm → Payment
4. **Question Flow:** Ask → Respond → Accept → Confirm → Payment

### Test Data
Use the test users and bids created by the setup scripts to test the complete flow.

---

## Security Considerations

1. **Role-based Access:** Each endpoint enforces proper role requirements
2. **Ownership Verification:** Users can only act on conversations they're part of
3. **Flow State Validation:** Actions are only allowed in appropriate states
4. **Turn-based Actions:** Users can only act when it's their turn

---

## Rate Limiting

Consider implementing rate limiting on these endpoints to prevent abuse:
- Maximum 10 actions per minute per user
- Maximum 5 conversations initialized per hour per brand owner

---

## Monitoring

Track these metrics for the automated flow system:
- Conversation completion rates
- Average time to completion
- Drop-off rates at each step
- User satisfaction scores
