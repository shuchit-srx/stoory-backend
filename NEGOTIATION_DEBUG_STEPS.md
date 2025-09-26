# Negotiation Flow Debug Steps

## 🎯 **Current Issue: Flow Still Goes to `chat_closed`**

### **🔍 Debug Steps to Identify the Problem**

#### **Step 1: Check Button Click Routing**

**Look for these logs in the backend console:**
```bash
🔄 [DEBUG] Routing to automated flow handler for button: agree_negotiation
🔄 [DEBUG] Current conversation state: { chat_status: 'automated', flow_state: 'brand_owner_negotiation', awaiting_role: 'brand_owner', user_role: 'brand_owner' }
🔄 [DEBUG] Mapped agree_negotiation to handle_negotiation with action: agree
🔄 [DEBUG] Calling automated flow service with: { action: 'handle_negotiation', data: { action: 'agree' } }
```

**If you DON'T see these logs:**
- The button click is not being routed to the automated flow handler
- Check if `conversation.chat_status === 'automated'` and `conversation.flow_state` exists

#### **Step 2: Check Automated Flow Service**

**Look for these logs:**
```bash
🔄 [DEBUG] Handling negotiation with data: { action: 'agree' }
✅ [DEBUG] Brand owner agreed to negotiate - setting state to influencer_price_response
✅ [DEBUG] Brand owner action completed successfully:
  - Action: handle_negotiation
  - Data: { action: 'agree' }
  - Flow state: influencer_price_response
  - Awaiting role: influencer
```

**If you DON'T see these logs:**
- The automated flow service is not being called
- Check the button click routing logic

#### **Step 3: Check Database Update**

**Query the conversation after the action:**
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
flow_state: influencer_price_response
awaiting_role: influencer
chat_status: automated
```

#### **Step 4: Check Frontend Response**

**Look at the network response:**
```javascript
// Expected Response
{
  "success": true,
  "conversation": {
    "flow_state": "influencer_price_response",
    "awaiting_role": "influencer"
  },
  "message": {
    "action_data": {
      "title": "💰 **Set Your Price Offer**",
      "subtitle": "What's your new price for this project?",
      "input_field": { ... },
      "buttons": [ ... ]
    }
  }
}
```

## 🐛 **Common Issues & Solutions**

### **Issue 1: Button Click Not Routed**
**Symptoms:** No debug logs starting with "🔄 [DEBUG] Routing to automated flow handler"
**Solution:** Check if conversation has `chat_status = 'automated'` and `flow_state` is not null

### **Issue 2: Wrong Action Mapping**
**Symptoms:** Debug log shows wrong action or data
**Solution:** Check the button click handler in `controllers/messageController.js` lines 1464-1467

### **Issue 3: Automated Flow Service Error**
**Symptoms:** "❌ [DEBUG] Automated flow handler failed" appears
**Solution:** Check the automated flow service logs and fix any errors

### **Issue 4: Database Update Failure**
**Symptoms:** All logs show success but database still shows `chat_closed`
**Solution:** Check database permissions and constraints

### **Issue 5: Frontend Not Handling Response**
**Symptoms:** Backend returns correct response but frontend doesn't update
**Solution:** Check frontend WebSocket handling and state management

## 🧪 **Test the Flow Manually**

### **Test 1: Check Button Click**
1. Open browser dev tools
2. Click "Agree to Negotiate" button
3. Check Network tab for the request
4. Check Console for any errors

### **Test 2: Check Backend Logs**
1. Look for the debug logs mentioned above
2. If logs are missing, the routing is broken
3. If logs show wrong data, the mapping is broken

### **Test 3: Check Database**
1. Query the conversation after clicking the button
2. Check if `flow_state` is `influencer_price_response`
3. Check if `awaiting_role` is `influencer`

### **Test 4: Check Frontend**
1. Check if the frontend receives the response
2. Check if the UI updates with the new state
3. Check if the input field appears for the influencer

## 🔧 **Quick Fixes**

### **Fix 1: Button Click Routing**
```javascript
// In controllers/messageController.js
if (conversation.chat_status === 'automated' && conversation.flow_state) {
  // Route to automated flow handler
  const automatedFlowService = require('../utils/automatedFlowService');
  // ... rest of the logic
}
```

### **Fix 2: Action Mapping**
```javascript
// Make sure this mapping exists
if (button_id === 'agree_negotiation') {
  action = 'handle_negotiation';
  data = { action: 'agree' };
}
```

### **Fix 3: Flow State**
```javascript
// In utils/automatedFlowService.js
if (data.action === "agree") {
  newFlowState = "influencer_price_response";
  newAwaitingRole = "influencer";
}
```

## 🎯 **Expected Flow After Fix**

1. **Brand owner clicks "Agree to Negotiate"**
2. **Backend logs show successful routing and processing**
3. **Flow state changes to `influencer_price_response`**
4. **Awaiting role changes to `influencer`**
5. **Influencer sees price input form**
6. **Brand owner sees negotiation accepted message**

## 🚀 **Next Steps**

1. **Run the debug steps above**
2. **Identify which step is failing**
3. **Apply the appropriate fix**
4. **Test the flow again**
5. **Report back with the specific logs/errors**

The debug logs will show exactly where the problem is occurring! 🔍
