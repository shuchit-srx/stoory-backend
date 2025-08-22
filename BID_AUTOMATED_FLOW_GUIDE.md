# Bid Automated Flow Guide

## Overview
This document outlines the complete automated conversation flow for bids, showing exactly what happens on both the brand owner and influencer sides, what messages are sent, and what data is stored at each step.

## Flow States
- `initial`: Brand owner sees bid application
- `connected`: Brand owner has responded to influencer
- `influencer_responding`: Influencer is responding to brand owner's action
- `negotiating`: Price negotiation in progress
- `brand_owner_selected`: Brand owner has selected influencer
- `influencer_selected`: Influencer has selected brand owner
- `both_confirmed`: Both parties have confirmed collaboration
- `payment_pending`: Payment is being processed
- `accepted`: Collaboration accepted
- `declined`: Collaboration declined

---

## Step-by-Step Automated Flow

### Step 1: Influencer Applies to Bid
**Trigger:** Influencer clicks "Apply" on a bid

**What happens:**
1. **Database:** Creates bid application record
   ```sql
   INSERT INTO bid_applications (
     bid_id, influencer_id, proposed_amount, 
     status, created_at
   ) VALUES (
     'bid-uuid', 'influencer-uuid', 5000,
     'pending', NOW()
   );
   ```

2. **Frontend shows Influencer:**
   - Application submitted confirmation
   - "Brand owner will review your application"

3. **Brand Owner sees:**
   - New applicant in their bid's applicant list
   - Influencer profile and proposed amount
   - "Start Chat" button for each applicant

**Data stored:**
- Bid application record
- No conversation created yet
- Application status: `pending`

---

### Step 2: Brand Owner Reviews Applicants
**Trigger:** Brand owner views their bid's applicant list

**What happens:**
1. **Frontend shows Brand Owner:**
   - List of all applicants for the bid
   - Each applicant shows:
     - Profile picture and name
     - Proposed amount
     - Application date
     - "Start Chat" button

2. **Brand Owner can:**
   - View applicant profiles
   - Compare proposed amounts
   - Choose which influencer to chat with

**No database changes yet**

---

### Step 3: Brand Owner Starts Chat
**Trigger:** Brand owner clicks "Start Chat" with a specific influencer

**What happens:**
1. **Database:** Creates conversation record
   ```sql
   INSERT INTO conversations (
     brand_owner_id, influencer_id, bid_id, 
     flow_state, awaiting_role, chat_status
   ) VALUES (
     'brand-uuid', 'influencer-uuid', 'bid-uuid',
     'initial', 'brand_owner', 'automated'
   );
   ```

2. **Message sent to Brand Owner:**
   ```
   "Hi! I see you've applied to my bid with ₹5000 amount. Let's discuss this.
   
   Thanks for your interest! I can:"
   
   [Accept your offer] [Negotiate price] [Ask questions]
   ```

3. **Frontend shows Brand Owner:**
   - Bid details (title, description, budget range)
   - Influencer's proposed amount
   - Action buttons: Accept, Negotiate, Ask Questions

**Data stored:**
- Conversation ID
- Flow state: `initial`
- Awaiting role: `brand_owner`
- Message with action buttons

---

### Step 4: Brand Owner Responds
**Trigger:** Brand owner clicks one of the action buttons

#### Option A: Brand Owner Accepts Offer
**What happens:**
1. **Message sent to Influencer:**
   ```
   "Brand owner has accepted your bid application.
   
   Bid Details:
   - Amount: ₹5000
   - Status: accepted
   
   You can now respond to this action."
   
   [Yes, I want to continue] [No, I don't want to continue]
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'influencer_responding', 
       awaiting_role = 'influencer'
   WHERE id = 'conversation-uuid';
   ```

3. **Frontend shows Influencer:**
   - Acceptance message
   - Bid details
   - Confirmation buttons

#### Option B: Brand Owner Negotiates Price
**What happens:**
1. **Message sent to Brand Owner:**
   ```
   "What's your proposed price?"
   
   [Text input field: "Enter your proposed amount (e.g., ₹5000)"]
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'negotiating', 
       awaiting_role = 'brand_owner'
   WHERE id = 'conversation-uuid';
   ```

3. **Frontend shows Brand Owner:**
   - Price input field
   - Submit button

#### Option C: Brand Owner Asks Questions
**What happens:**
1. **Message sent to Brand Owner:**
   ```
   "What would you like to ask the influencer?"
   
   [Text input field: "Type your question here"]
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'negotiating', 
       awaiting_role = 'brand_owner'
   WHERE id = 'conversation-uuid';
   ```

3. **Frontend shows Brand Owner:**
   - Question input field
   - Submit button

---

### Step 5: Influencer Responds to Brand Owner's Action

#### If Brand Owner Accepted:
**Trigger:** Influencer clicks confirmation button

**What happens:**
1. **If Influencer confirms:**
   - **Message sent to Brand Owner:**
     ```
     "Influencer has confirmed the collaboration.
     
     Bid Details:
     - Amount: ₹5000
     - Status: confirmed
     
     You can now confirm to proceed to payment."
     
     [Yes, proceed to payment] [No, cancel]
     ```
   
   - **Database updates:**
     ```sql
     UPDATE conversations 
     SET flow_state = 'brand_owner_confirming', 
         awaiting_role = 'brand_owner'
     WHERE id = 'conversation-uuid';
     ```

2. **If Influencer rejects:**
   - **Message sent to Brand Owner:**
     ```
     "Influencer has declined the collaboration.
     
     Status: declined"
     ```
   
   - **Database updates:**
     ```sql
     UPDATE conversations 
     SET flow_state = 'declined'
     WHERE id = 'conversation-uuid';
     ```

#### If Brand Owner Negotiated Price:
**Trigger:** Brand owner enters new price

**What happens:**
1. **Message sent to Influencer:**
   ```
   "Brand owner has proposed ₹4500 (original: ₹5000)
   
   You can:"
   
   [Accept] [Make counter offer] [Decline]
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'influencer_responding', 
       awaiting_role = 'influencer'
   WHERE id = 'conversation-uuid';
   ```

3. **Frontend shows Influencer:**
   - New proposed amount
   - Response options

#### If Brand Owner Asked Questions:
**Trigger:** Brand owner submits question

**What happens:**
1. **Message sent to Influencer:**
   ```
   "Brand owner has a question:
   
   'What's your experience with this type of content?'
   
   You can:"
   
   [Respond] [Ignore] [Reject]
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'influencer_responding', 
       awaiting_role = 'influencer'
   WHERE id = 'conversation-uuid';
   ```

3. **Frontend shows Influencer:**
   - Question content
   - Response options

---

### Step 6: Price Negotiation Flow (if applicable)

#### Influencer Makes Counter Offer:
**What happens:**
1. **Message sent to Brand Owner:**
   ```
   "Influencer has proposed ₹4800 (original: ₹5000)
   
   You can:"
   
   [Accept] [Make counter offer] [Decline]
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'negotiating', 
       awaiting_role = 'brand_owner'
   WHERE id = 'conversation-uuid';
   ```

#### Final Price Agreement:
**What happens:**
1. **Message sent to both parties:**
   ```
   "Price agreed: ₹4800
   
   You can now confirm the collaboration."
   
   [Confirm collaboration] [Decline]
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'both_confirmed'
   WHERE id = 'conversation-uuid';
   ```

---

### Step 7: Question Response Flow (if applicable)

#### Influencer Responds to Question:
**What happens:**
1. **Message sent to Brand Owner:**
   ```
   "Influencer has responded to your question:
   
   'I have 3 years of experience creating similar content...'
   
   You can:"
   
   [Accept offer] [Ask more questions] [Decline]
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'brand_owner_confirming', 
       awaiting_role = 'brand_owner'
   WHERE id = 'conversation-uuid';
   ```

---

### Step 8: Final Confirmation and Payment

#### Both Parties Confirm:
**What happens:**
1. **Message sent to both parties:**
   ```
   "Both parties have confirmed the collaboration!
   
   Final Details:
   - Amount: ₹4800
   - Bid: Product Promotion Campaign
   
   Payment will be initiated now."
   ```

2. **Database updates:**
   ```sql
   UPDATE conversations 
   SET flow_state = 'payment_pending',
       payment_required = true
   WHERE id = 'conversation-uuid';
   ```

3. **Payment system triggered:**
   - Creates payment record
   - Initiates escrow process
   - Sends payment confirmation

---

## Data Storage Summary

### Messages Table
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id),
  sender_id UUID REFERENCES users(id),
  receiver_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  message_type VARCHAR(50), -- 'automated', 'manual'
  action_required BOOLEAN DEFAULT false,
  action_data JSONB, -- Stores buttons, input fields, visibility
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Bid Applications Table
```sql
CREATE TABLE bid_applications (
  id UUID PRIMARY KEY,
  bid_id UUID REFERENCES bids(id),
  influencer_id UUID REFERENCES users(id),
  proposed_amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'withdrawn'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Conversations Table
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  brand_owner_id UUID REFERENCES users(id),
  influencer_id UUID REFERENCES users(id),
  bid_id UUID REFERENCES bids(id),
  flow_state VARCHAR(50) DEFAULT 'initial',
  awaiting_role VARCHAR(20), -- 'brand_owner', 'influencer', null
  chat_status VARCHAR(20) DEFAULT 'automated', -- 'automated', 'realtime', 'closed'
  payment_required BOOLEAN DEFAULT false,
  payment_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Action Data Structure
```json
{
  "buttons": [
    {
      "id": "accept_offer",
      "text": "Accept your offer",
      "style": "success"
    }
  ],
  "input_field": {
    "type": "text",
    "placeholder": "Enter amount",
    "required": true
  },
  "flow_state": "influencer_responding",
  "message_type": "brand_owner_accept",
  "visible_to": "influencer"
}
```

---

## Frontend Implementation Notes

### For Brand Owner:
1. **Show bid details** with influencer's proposed amount
2. **Display action buttons** based on conversation state
3. **Handle text input** for price negotiation and questions
4. **Show confirmation prompts** before finalizing

### For Influencer:
1. **Show brand owner's responses** with appropriate context
2. **Display response options** based on brand owner's action
3. **Handle counter-offers** and question responses
4. **Show final confirmation** before payment

### Real-time Updates:
- Listen for new messages via WebSocket
- Refresh conversation context when state changes
- Update UI based on `awaiting_role` and `flow_state`

---

## Error Handling

### Common Scenarios:
1. **User tries to act when not their turn:**
   - Return error: "Awaiting other participant's response"
   - Disable action buttons

2. **Conversation already exists:**
   - Return existing conversation ID
   - Redirect to existing conversation

3. **Invalid flow state:**
   - Reset to appropriate state
   - Show error message

4. **Payment failures:**
   - Revert to confirmation state
   - Allow retry or cancellation

---

## Testing Checklist

### Brand Owner Flow:
- [ ] Can see influencer's bid application
- [ ] Can accept, negotiate, or ask questions
- [ ] Can enter price for negotiation
- [ ] Can ask questions
- [ ] Can confirm final collaboration
- [ ] Can proceed to payment

### Influencer Flow:
- [ ] Can see brand owner's responses
- [ ] Can confirm or reject offers
- [ ] Can make counter offers
- [ ] Can respond to questions
- [ ] Can confirm final collaboration
- [ ] Can see payment initiation

### System Flow:
- [ ] Messages are sent to correct recipients
- [ ] Flow states update correctly
- [ ] Action buttons appear appropriately
- [ ] Payment triggers after confirmation
- [ ] Real-time updates work
- [ ] Error handling works correctly
