# Comprehensive Debug Guide for Negotiation Flow

## 🎯 **Issue: Chat Still Closing After "Agree to Negotiate"**

### **🔍 Debug Steps to Follow**

#### **Step 1: Check Button Click Routing**

**Look for these logs in the backend console:**
```bash
🔍 [DEBUG] Checking conversation type: {
  chat_status: 'automated',
  flow_state: 'brand_owner_negotiation',
  is_automated: true,
  has_flow_state: true
}

🔄 [DEBUG] Routing to automated flow handler for button: agree_negotiation
🔄 [DEBUG] Current conversation state: {
  chat_status: 'automated',
  flow_state: 'brand_owner_negotiation',
  awaiting_role: 'brand_owner',
  user_role: 'brand_owner'
}
```

**If you DON'T see these logs:**
- The conversation is not in automated mode
- The flow_state is missing
- The button click is not being routed correctly

#### **Step 2: Check Button Mapping**

**Look for these logs:**
```bash
🔍 [DEBUG] Processing brand owner button mapping for: agree_negotiation
🔄 [DEBUG] Mapped agree_negotiation to handle_negotiation with action: agree
🔄 [DEBUG] Calling automated flow service with: { action: 'handle_negotiation', data: { action: 'agree' } }
```

**If you DON'T see these logs:**
- The button mapping is not working
- The button_id is not 'agree_negotiation'

#### **Step 3: Check Automated Flow Service**

**Look for these logs:**
```bash
🔍 [DEBUG] handleBrandOwnerAction called:
  - conversationId: {conversation_id}
  - action: handle_negotiation
  - data: { action: 'agree' }

🔍 [DEBUG] Fetching conversation: {conversation_id}
✅ [DEBUG] Conversation found: {
  id: '{conversation_id}',
  chat_status: 'automated',
  flow_state: 'brand_owner_negotiation',
  awaiting_role: 'brand_owner',
  brand_owner_id: '{brand_owner_id}',
  influencer_id: '{influencer_id}'
}
```

**If you DON'T see these logs:**
- The automated flow service is not being called
- The conversation is not being found

#### **Step 4: Check Negotiation Handling**

**Look for these logs:**
```bash
🔄 [DEBUG] Handling negotiation with data: { action: 'agree' }
🔄 [DEBUG] Data action: agree
🔄 [DEBUG] Data action type: string
🔄 [DEBUG] Data action === 'agree': true
✅ [DEBUG] Brand owner agreed to negotiate - setting state to influencer_price_response
```

**If you see this instead:**
```bash
🔄 [DEBUG] Data action: {action: 'agree'}  // Wrong format!
🔄 [DEBUG] Data action type: object
🔄 [DEBUG] Data action === 'agree': false
❌ [DEBUG] Brand owner rejected negotiation - setting state to chat_closed
❌ [DEBUG] Data action was: {action: 'agree'}
❌ [DEBUG] This is why chat is closing!
```

**This means the data format is wrong!**

#### **Step 5: Check Database Update**

**Look for these logs:**
```bash
🔄 [DEBUG] Updating conversation with data: {
  flow_state: 'influencer_price_response',
  awaiting_role: 'influencer'
}
✅ [DEBUG] Conversation updated successfully
```

**If you DON'T see these logs:**
- The database update is failing
- The conversation is not being updated

#### **Step 6: Check Final Result**

**Look for these logs:**
```bash
✅ [DEBUG] Brand owner action completed successfully:
  - Action: handle_negotiation
  - Data: { action: 'agree' }
  - Flow state: influencer_price_response
  - Awaiting role: influencer
  - Has current_action_data: false
  - Message created: true
  - Audit message created: true
✅ [DEBUG] Final result conversation: { flow_state: 'influencer_price_response', awaiting_role: 'influencer' }
✅ [DEBUG] Final result message: Present
```

**If you see `flow_state: 'chat_closed'`:**
- The negotiation handling is going to the wrong branch
- The data format is incorrect

## 🐛 **Common Issues & Solutions**

### **Issue 1: Wrong Data Format**
**Symptoms:**
```bash
🔄 [DEBUG] Data action: {action: 'agree'}  // Should be 'agree'
🔄 [DEBUG] Data action type: object        // Should be string
```

**Solution:** Check the button click handler data mapping:
```javascript
// Should be:
data = { action: 'agree' };

// Not:
data = { action: { action: 'agree' } };
```

### **Issue 2: Button Not Mapped**
**Symptoms:**
```bash
⚠️ [DEBUG] No special mapping found for button: {button_id}
```

**Solution:** Check if the button_id is exactly 'agree_negotiation'

### **Issue 3: Conversation Not Found**
**Symptoms:**
```bash
❌ [DEBUG] Conversation not found: {error}
```

**Solution:** Check if the conversation exists and is accessible

### **Issue 4: Database Update Fails**
**Symptoms:**
```bash
❌ [DEBUG] Failed to update conversation: {error}
```

**Solution:** Check database permissions and constraints

### **Issue 5: Wrong Flow State**
**Symptoms:**
```bash
✅ [DEBUG] Final result conversation: { flow_state: 'chat_closed', awaiting_role: null }
```

**Solution:** The negotiation handling is going to the reject branch instead of agree branch

## 🧪 **Test the Flow Step by Step**

### **Test 1: Check Button Click**
1. Open browser dev tools
2. Click "Agree to Negotiate" button
3. Check Network tab for the request
4. Look for the debug logs in backend console

### **Test 2: Check Data Format**
Look for this specific log:
```bash
🔄 [DEBUG] Data action: agree  // Should be 'agree' (string)
```

If you see:
```bash
🔄 [DEBUG] Data action: {action: 'agree'}  // Wrong - object instead of string
```

### **Test 3: Check Database State**
After the action, query the conversation:
```sql
SELECT flow_state, awaiting_role, chat_status 
FROM conversations 
WHERE id = 'your_conversation_id';
```

**Expected Result:**
```
flow_state: influencer_price_response
awaiting_role: influencer
chat_status: automated
```

**If you see:**
```
flow_state: chat_closed
awaiting_role: null
```

**This means the negotiation handling went to the wrong branch!**

## 🔧 **Quick Fixes**

### **Fix 1: Data Format Issue**
If the data format is wrong, check the button click handler:
```javascript
// In controllers/messageController.js
if (button_id === 'agree_negotiation') {
  action = 'handle_negotiation';
  data = { action: 'agree' };  // Make sure this is correct
}
```

### **Fix 2: Button ID Issue**
Make sure the frontend is sending the correct button_id:
```javascript
// Frontend should send:
{
  "button_id": "agree_negotiation",
  "additional_data": {}
}
```

### **Fix 3: Conversation State Issue**
Check if the conversation is in the correct state before the action:
```sql
SELECT flow_state, awaiting_role, chat_status 
FROM conversations 
WHERE id = 'your_conversation_id';
```

**Should be:**
```
flow_state: brand_owner_negotiation
awaiting_role: brand_owner
chat_status: automated
```

## 🎯 **Expected Debug Flow**

### **Successful Flow:**
```bash
🔍 [DEBUG] Checking conversation type: { chat_status: 'automated', flow_state: 'brand_owner_negotiation', is_automated: true, has_flow_state: true }
🔄 [DEBUG] Routing to automated flow handler for button: agree_negotiation
🔍 [DEBUG] Processing brand owner button mapping for: agree_negotiation
🔄 [DEBUG] Mapped agree_negotiation to handle_negotiation with action: agree
🔄 [DEBUG] Calling automated flow service with: { action: 'handle_negotiation', data: { action: 'agree' } }
🔍 [DEBUG] handleBrandOwnerAction called: { conversationId: '...', action: 'handle_negotiation', data: { action: 'agree' } }
🔍 [DEBUG] Fetching conversation: ...
✅ [DEBUG] Conversation found: { id: '...', chat_status: 'automated', flow_state: 'brand_owner_negotiation', awaiting_role: 'brand_owner' }
🔄 [DEBUG] Handling negotiation with data: { action: 'agree' }
🔄 [DEBUG] Data action: agree
🔄 [DEBUG] Data action type: string
🔄 [DEBUG] Data action === 'agree': true
✅ [DEBUG] Brand owner agreed to negotiate - setting state to influencer_price_response
🔄 [DEBUG] Updating conversation with data: { flow_state: 'influencer_price_response', awaiting_role: 'influencer' }
✅ [DEBUG] Conversation updated successfully
✅ [DEBUG] Brand owner action completed successfully: { flow_state: 'influencer_price_response', awaiting_role: 'influencer' }
✅ [DEBUG] Automated flow handler succeeded: { flow_state: 'influencer_price_response', awaiting_role: 'influencer' }
```

### **Failed Flow (Chat Closing):**
```bash
🔄 [DEBUG] Data action: {action: 'agree'}  // Wrong format!
🔄 [DEBUG] Data action type: object
🔄 [DEBUG] Data action === 'agree': false
❌ [DEBUG] Brand owner rejected negotiation - setting state to chat_closed
❌ [DEBUG] Data action was: {action: 'agree'}
❌ [DEBUG] This is why chat is closing!
```

## 🚀 **Next Steps**

1. **Run the debug steps above**
2. **Identify which step is failing**
3. **Check the specific logs mentioned**
4. **Apply the appropriate fix**
5. **Test the flow again**

**The debug logs will show exactly where the problem is occurring!** 🔍
