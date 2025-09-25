# WebSocket Integration for Negotiation Flow

## 🎯 **Issue Identified: Missing WebSocket Emits**

The negotiation flow was not working because the automated flow service was **not emitting WebSocket events** for real-time updates. The frontend was not receiving the state changes and new messages.

## ✅ **Fixes Applied**

### **1. Added WebSocket Integration to Automated Flow Service**

#### **Constructor & IO Setup:**
```javascript
class AutomatedFlowService {
  constructor() {
    this.io = null;
  }

  setIO(io) {
    this.io = io;
  }
}
```

#### **WebSocket Emits in Brand Owner Actions:**
```javascript
// Emit conversation state change
this.io.to(`conversation_${conversationId}`).emit('conversation_state_changed', {
  conversation_id: conversationId,
  flow_state: newFlowState,
  awaiting_role: newAwaitingRole,
  chat_status: 'automated',
  updated_at: new Date().toISOString()
});

// Emit new message to conversation room
this.io.to(`conversation_${conversationId}`).emit('new_message', {
  conversation_id: conversationId,
  message: result.message,
  conversation_context: { ... }
});
```

#### **WebSocket Emits in Influencer Actions:**
```javascript
// Same WebSocket integration for influencer actions
// Ensures real-time updates for both roles
```

### **2. Initialized WebSocket in Main Application**

#### **index.js Setup:**
```javascript
// Set socket for automated flow service
const automatedFlowService = require("./utils/automatedFlowService");
automatedFlowService.setIO(io);
```

## 🔄 **WebSocket Events Emitted**

### **1. Conversation State Change**
```javascript
Event: 'conversation_state_changed'
Data: {
  conversation_id: "uuid",
  flow_state: "influencer_price_response",
  awaiting_role: "influencer",
  chat_status: "automated",
  updated_at: "2024-01-01T00:00:00.000Z"
}
```

### **2. New Message**
```javascript
Event: 'new_message'
Data: {
  conversation_id: "uuid",
  message: {
    id: "message_id",
    conversation_id: "uuid",
    sender_id: "brand_owner_id",
    receiver_id: "influencer_id",
    message: "🤝 **Negotiation Accepted**...",
    message_type: "automated",
    action_required: true,
    action_data: {
      title: "💰 **Set Your Price Offer**",
      subtitle: "What's your new price for this project?",
      input_field: { ... },
      buttons: [ ... ]
    }
  },
  conversation_context: {
    id: "uuid",
    chat_status: "automated",
    flow_state: "influencer_price_response",
    awaiting_role: "influencer",
    conversation_type: "bid",
    automation_enabled: true,
    current_action_data: { ... }
  }
}
```

### **3. Audit Message**
```javascript
Event: 'new_message'
Data: {
  conversation_id: "uuid",
  message: {
    id: "audit_message_id",
    conversation_id: "uuid",
    sender_id: "system_user_id",
    receiver_id: "brand_owner_id",
    message: "✅ **Action Taken: Negotiation Accepted**...",
    message_type: "audit",
    action_required: false
  },
  conversation_context: { ... }
}
```

## 🎯 **Frontend Integration**

### **WebSocket Event Listeners**
```javascript
// Listen for conversation state changes
socket.on('conversation_state_changed', (data) => {
  console.log('Conversation state changed:', data);
  updateConversationState(data);
});

// Listen for new messages
socket.on('new_message', (data) => {
  console.log('New message received:', data);
  addMessageToChat(data.message);
  updateConversationContext(data.conversation_context);
});

// Join conversation room
socket.emit('join_conversation', { conversation_id: conversationId });
```

### **State Management**
```javascript
// Update conversation state
const updateConversationState = (data) => {
  setConversation(prev => ({
    ...prev,
    flow_state: data.flow_state,
    awaiting_role: data.awaiting_role,
    chat_status: data.chat_status,
    updated_at: data.updated_at
  }));
};

// Update conversation context
const updateConversationContext = (context) => {
  setConversation(prev => ({
    ...prev,
    ...context
  }));
};
```

## 🔧 **Debug WebSocket Events**

### **Backend Logs to Look For:**
```bash
📡 [DEBUG] WebSocket events emitted for conversation: {conversation_id}
📡 [DEBUG] Socket emitting new_message to conversation_{conversation_id}
📡 [DEBUG] Socket emitting conversation_state_changed to conversation_{conversation_id}
```

### **Frontend Console Logs:**
```javascript
// Should see these events
conversation_state_changed: { flow_state: "influencer_price_response", awaiting_role: "influencer" }
new_message: { message: { action_data: { input_field: {...}, buttons: [...] } } }
```

## 🎯 **Complete Flow with WebSocket**

### **Step 1: Brand Owner Clicks "Agree to Negotiate"**
1. **Button Click:** `agree_negotiation` → `handle_negotiation` with `action: 'agree'`
2. **Backend Processing:** Sets `flow_state: "influencer_price_response"`, `awaiting_role: "influencer"`
3. **WebSocket Emit:** `conversation_state_changed` + `new_message` events
4. **Frontend Update:** Receives events, updates UI, shows price input form

### **Step 2: Influencer Sends Counter Offer**
1. **Button Click:** `send_counter_offer` with price data
2. **Backend Processing:** Sets `flow_state: "brand_owner_price_response"`, `awaiting_role: "brand_owner"`
3. **WebSocket Emit:** `conversation_state_changed` + `new_message` events
4. **Frontend Update:** Brand owner sees counter offer with accept/reject buttons

### **Step 3: Brand Owner Responds**
1. **Button Click:** `accept_counter_offer` or `reject_counter_offer`
2. **Backend Processing:** Sets appropriate flow state
3. **WebSocket Emit:** Real-time updates to both users
4. **Frontend Update:** Both users see updated state

## 🚀 **Result**

### **✅ What's Now Working:**
- ✅ **Real-time state updates** via WebSocket
- ✅ **Live message delivery** to both users
- ✅ **Automatic UI updates** when state changes
- ✅ **Proper conversation context** in all events
- ✅ **Audit message delivery** for action tracking

### **🎯 Key Benefits:**
- ✅ **No page refresh needed** - everything updates in real-time
- ✅ **Both users see changes** immediately
- ✅ **Proper state management** throughout the flow
- ✅ **Seamless user experience** with live updates

## 🎉 **The negotiation flow now has full WebSocket integration!**

**The frontend will now receive real-time updates for:**
- ✅ **State changes** (flow_state, awaiting_role)
- ✅ **New messages** with action data
- ✅ **Audit messages** for action tracking
- ✅ **Conversation context** updates

**This ensures the negotiation flow works seamlessly with real-time updates!** 🚀
