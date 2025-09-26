# Negotiation Flow Debugging Guide

## 🎯 Issue: Brand Owner "Agree to Negotiate" Sets Chat to Closed

### **Problem Description:**
When brand owner clicks "Agree to Negotiate", the conversation flow state is being set to `chat_closed` instead of `negotiation_input`.

### **Expected Behavior:**
1. Brand owner clicks "Agree to Negotiate"
2. Backend should set `flow_state: "negotiation_input"` and `awaiting_role: "brand_owner"`
3. Brand owner should see price input form
4. Influencer should see that negotiation was accepted

### **Actual Behavior:**
1. Brand owner clicks "Agree to Negotiate"
2. Backend sets `flow_state: "chat_closed"`
3. Conversation ends

## 🔍 Debugging Steps

### **1. Check Backend Logs**

Look for these debug logs in the backend console:

```bash
# When button is clicked
🔄 [DEBUG] Routing to automated flow handler for button: agree_negotiation
🔄 [DEBUG] Current conversation state: { chat_status: 'automated', flow_state: 'brand_owner_negotiation', awaiting_role: 'brand_owner', user_role: 'brand_owner' }
🔄 [DEBUG] Mapped agree_negotiation to handle_negotiation with action: agree
🔄 [DEBUG] Calling automated flow service with: { action: 'handle_negotiation', data: { action: 'agree' } }

# In automated flow service
🔄 [DEBUG] Handling negotiation with data: { action: 'agree' }
✅ [DEBUG] Brand owner agreed to negotiate - setting state to negotiation_input

# Final result
✅ [DEBUG] Automated flow handler succeeded: { flow_state: 'negotiation_input', awaiting_role: 'brand_owner' }
✅ [DEBUG] Brand owner action completed successfully:
  - Action: handle_negotiation
  - Data: { action: 'agree' }
  - Flow state: negotiation_input
  - Awaiting role: brand_owner
```

### **2. Check Frontend Network Tab**

In the browser's Network tab, look for the button click request:

**Request:**
```javascript
POST /api/messages/conversations/{conversation_id}/button-click
{
  "button_id": "agree_negotiation",
  "additional_data": {}
}
```

**Expected Response:**
```javascript
{
  "success": true,
  "conversation": {
    "id": "conversation_id",
    "flow_state": "negotiation_input",
    "awaiting_role": "brand_owner",
    "current_action_data": {
      "title": "🎯 **New Price Offer**",
      "subtitle": "Enter a new price offer (must be different from the previous offer):",
      "input_field": {
        "id": "new_price",
        "type": "number",
        "placeholder": "Enter new price amount",
        "required": true,
        "min": 1
      },
      "submit_button": {
        "text": "Send New Offer",
        "style": "success"
      }
    }
  },
  "message": {
    "id": "message_id",
    "conversation_id": "conversation_id",
    "sender_id": "brand_owner_id",
    "receiver_id": "influencer_id",
    "message": "🤝 **Negotiation Accepted**\n\nBrand owner has agreed to negotiate. Please enter a new price offer.",
    "message_type": "automated",
    "action_required": true,
    "action_data": { ... }
  }
}
```

### **3. Check Database State**

Query the conversation to see the current state:

```sql
SELECT 
  id, 
  flow_state, 
  awaiting_role, 
  chat_status, 
  updated_at 
FROM conversations 
WHERE id = 'your_conversation_id';
```

**Expected Result:**
```
flow_state: negotiation_input
awaiting_role: brand_owner
chat_status: automated
```

## 🐛 Common Issues & Solutions

### **Issue 1: Button Click Not Routed to Automated Flow**

**Symptoms:**
- No debug logs starting with "🔄 [DEBUG] Routing to automated flow handler"
- Button click goes to old handler

**Solution:**
Check that the conversation has:
- `chat_status = 'automated'`
- `flow_state` is not null

### **Issue 2: Wrong Action Mapping**

**Symptoms:**
- Debug log shows wrong action or data
- "Mapped agree_negotiation to handle_negotiation" not appearing

**Solution:**
Check the button click handler in `controllers/messageController.js` lines 1464-1467

### **Issue 3: Automated Flow Service Error**

**Symptoms:**
- "❌ [DEBUG] Automated flow handler failed" appears
- Exception in automated flow service

**Solution:**
Check the automated flow service logs and fix any errors in `utils/automatedFlowService.js`

### **Issue 4: Database Update Failure**

**Symptoms:**
- All logs show success but database still shows `chat_closed`
- Conversation update fails

**Solution:**
Check database permissions and constraints

## 🔧 Testing the Fix

### **Test Case 1: Happy Path**

1. **Setup:** Create a conversation in `brand_owner_negotiation` state
2. **Action:** Brand owner clicks "Agree to Negotiate"
3. **Expected:** 
   - Flow state changes to `negotiation_input`
   - Awaiting role changes to `brand_owner`
   - Brand owner sees price input form

### **Test Case 2: Rejection Path**

1. **Setup:** Create a conversation in `brand_owner_negotiation` state
2. **Action:** Brand owner clicks "Reject Negotiation"
3. **Expected:**
   - Flow state changes to `chat_closed`
   - Awaiting role becomes null
   - Conversation ends

### **Test Case 3: Error Handling**

1. **Setup:** Create a conversation in `brand_owner_negotiation` state
2. **Action:** Send invalid button_id
3. **Expected:**
   - Falls back to old handler
   - Returns appropriate error message

## 📊 Debug Log Analysis

### **Successful Flow Logs:**
```
🔄 [DEBUG] Routing to automated flow handler for button: agree_negotiation
🔄 [DEBUG] Current conversation state: { chat_status: 'automated', flow_state: 'brand_owner_negotiation', awaiting_role: 'brand_owner', user_role: 'brand_owner' }
🔄 [DEBUG] Mapped agree_negotiation to handle_negotiation with action: agree
🔄 [DEBUG] Calling automated flow service with: { action: 'handle_negotiation', data: { action: 'agree' } }
🔄 [DEBUG] Handling negotiation with data: { action: 'agree' }
✅ [DEBUG] Brand owner agreed to negotiate - setting state to negotiation_input
✅ [DEBUG] Automated flow handler succeeded: { flow_state: 'negotiation_input', awaiting_role: 'brand_owner' }
✅ [DEBUG] Brand owner action completed successfully:
  - Action: handle_negotiation
  - Data: { action: 'agree' }
  - Flow state: negotiation_input
  - Awaiting role: brand_owner
```

### **Failed Flow Logs:**
```
🔄 [DEBUG] Routing to automated flow handler for button: agree_negotiation
❌ [DEBUG] Automated flow handler failed: Error: Some error message
🔄 [DEBUG] Falling back to old handler
```

## 🎯 Quick Fix Checklist

- [ ] Check conversation has `chat_status = 'automated'`
- [ ] Check conversation has `flow_state` set
- [ ] Verify button click routing logs appear
- [ ] Verify action mapping logs appear
- [ ] Verify automated flow service logs appear
- [ ] Check final result logs show correct flow state
- [ ] Verify database state after action
- [ ] Test both agree and reject paths

## 🚀 Expected Resolution

After implementing the debug logging and fixes:

1. **Brand owner clicks "Agree to Negotiate"**
2. **Backend logs show successful routing and processing**
3. **Flow state changes to `negotiation_input`**
4. **Brand owner sees price input form**
5. **Influencer sees negotiation accepted message**

The negotiation flow should now work correctly! 🎉
