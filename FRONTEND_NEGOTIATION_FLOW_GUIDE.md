# Frontend Negotiation Flow Implementation Guide

This document provides a comprehensive guide for implementing the negotiation flow in the frontend application. It covers all UI components, API endpoints, WebSocket events, and state management required for a complete negotiation system.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Flow States](#flow-states)
3. [API Endpoints](#api-endpoints)
4. [WebSocket Events](#websocket-events)
5. [UI Components](#ui-components)
6. [State Management](#state-management)
7. [Implementation Examples](#implementation-examples)
8. [Error Handling](#error-handling)
9. [Testing](#testing)

## 🎯 Overview

The negotiation flow is a sophisticated system that allows brand owners and influencers to negotiate pricing through structured, automated conversations. The frontend must handle:

- **Multi-round negotiations** with history tracking
- **Rich UI components** for price input and action buttons
- **Real-time updates** via WebSocket events
- **State management** for conversation flow
- **Validation** and error handling

## 🔄 Flow States

### Negotiation Flow States

```javascript
const NEGOTIATION_STATES = {
  // Initial pricing
  'influencer_price_response': 'Influencer responds to initial price',
  'brand_owner_pricing': 'Brand owner sets initial price',
  
  // Negotiation process
  'brand_owner_negotiation': 'Brand owner handles negotiation request',
  'negotiation_input': 'Brand owner enters new price offer',
  'influencer_final_response': 'Influencer makes final decision',
  
  // Resolution
  'payment_pending': 'Price agreed, awaiting payment',
  'chat_closed': 'Negotiation failed or rejected'
};
```

### Awaiting Role System

```javascript
const AWAITING_ROLES = {
  'influencer': 'Influencer needs to take action',
  'brand_owner': 'Brand owner needs to take action',
  null: 'No action required'
};
```

## 🌐 API Endpoints

### 1. Button Click Handler

**Endpoint:** `POST /api/messages/conversations/:conversation_id/button-click`

**Purpose:** Handle button clicks in negotiation flow

```javascript
// Request
{
  "button_id": "negotiate_price",
  "additional_data": {
    "price": 5000,
    "action": "agree"
  }
}

// Response
{
  "success": true,
  "message": "Action processed successfully",
  "conversation_context": {
    "id": "uuid",
    "flow_state": "negotiation_input",
    "awaiting_role": "brand_owner",
    "flow_data": {
      "current_amount": 5000,
      "negotiation_history": [...]
    }
  }
}
```

### 2. Text Input Handler

**Endpoint:** `POST /api/messages/conversations/:conversation_id/text-input`

**Purpose:** Handle text input for price negotiation

```javascript
// Request
{
  "text": "₹5000",
  "input_type": "negotiation",
  "additional_data": {
    "price": 5000
  }
}

// Response
{
  "success": true,
  "message": "Price offer sent",
  "conversation_context": {
    "flow_state": "influencer_final_response",
    "awaiting_role": "influencer"
  }
}
```

### 3. Get Conversation Context

**Endpoint:** `GET /api/messages/conversations/:conversation_id/context`

**Purpose:** Get current conversation state and negotiation data

```javascript
// Response
{
  "success": true,
  "conversation": {
    "id": "uuid",
    "flow_state": "brand_owner_negotiation",
    "awaiting_role": "brand_owner",
    "flow_data": {
      "current_amount": 5000,
      "negotiation_count": 1,
      "max_negotiations": 3,
      "negotiation_history": [
        {
          "type": "influencer_counter",
          "amount": 5000,
          "timestamp": "2024-01-01T00:00:00Z",
          "message": "Influencer counter-offered ₹5000"
        }
      ]
    }
  }
}
```

## 🔌 WebSocket Events

### Client → Server Events

```javascript
// Join conversation room
socket.emit('join_conversation', conversationId);

// Send message
socket.emit('send_message', {
  conversationId,
  senderId,
  receiverId,
  message,
  mediaUrl
});

// Handle button click
socket.emit('button_click', {
  conversationId,
  buttonId: 'negotiate_price',
  additionalData: { price: 5000 }
});

// Handle text input
socket.emit('text_input', {
  conversationId,
  text: '₹5000',
  inputType: 'negotiation'
});
```

### Server → Client Events

```javascript
// New message received
socket.on('new_message', (data) => {
  const { conversation_id, message, conversation_context } = data;
  // Update UI with new message
  updateMessageList(conversation_id, message);
  updateConversationContext(conversation_id, conversation_context);
});

// Conversation state change
socket.on('conversation_state_changed', (data) => {
  const { conversation_id, previous_state, new_state, reason } = data;
  // Update conversation state
  updateConversationState(conversation_id, new_state);
});

// Button action response
socket.on('button_action', (data) => {
  const { button_id, message, flow_update, conversationId } = data;
  // Handle button action response
  handleButtonActionResponse(button_id, message, flow_update);
});

// Notification
socket.on('notification', (data) => {
  // Show notification to user
  showNotification(data);
});
```

## 🎨 UI Components

### 1. Negotiation Request Component

```jsx
const NegotiationRequestComponent = ({ message, onAction }) => {
  const { action_data } = message;
  
  return (
    <div className="negotiation-request">
      <h3>{action_data.title}</h3>
      <p>{action_data.subtitle}</p>
      
      <div className="button-group">
        {action_data.buttons.map(button => (
          <button
            key={button.id}
            className={`btn btn-${button.style}`}
            onClick={() => onAction(button.id, button.data)}
          >
            {button.text}
          </button>
        ))}
      </div>
    </div>
  );
};
```

### 2. Price Input Component

```jsx
const PriceInputComponent = ({ action_data, onInput }) => {
  const [price, setPrice] = useState('');
  
  const handleSubmit = () => {
    if (price && parseFloat(price) > 0) {
      onInput('price_input', { price: parseFloat(price) });
    }
  };
  
  return (
    <div className="price-input">
      <h3>{action_data.title}</h3>
      <p>{action_data.subtitle}</p>
      
      <div className="input-group">
        <span className="currency-symbol">₹</span>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={action_data.input_field.placeholder}
          min={action_data.input_field.min}
          required={action_data.input_field.required}
        />
      </div>
      
      <button
        className={`btn btn-${action_data.submit_button.style}`}
        onClick={handleSubmit}
        disabled={!price || parseFloat(price) <= 0}
      >
        {action_data.submit_button.text}
      </button>
    </div>
  );
};
```

### 3. Negotiation History Component

```jsx
const NegotiationHistoryComponent = ({ negotiationHistory }) => {
  return (
    <div className="negotiation-history">
      <h4>Negotiation History</h4>
      <div className="history-timeline">
        {negotiationHistory.map((entry, index) => (
          <div key={index} className="history-entry">
            <div className="entry-type">{entry.type}</div>
            <div className="entry-amount">₹{entry.amount}</div>
            <div className="entry-message">{entry.message}</div>
            <div className="entry-timestamp">
              {new Date(entry.timestamp).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### 4. Final Response Component

```jsx
const FinalResponseComponent = ({ action_data, onAction }) => {
  const isFinalOffer = action_data.subtitle.includes('final offer');
  
  return (
    <div className="final-response">
      <h3>{action_data.title}</h3>
      <p>{action_data.subtitle}</p>
      
      <div className="button-group">
        {action_data.buttons.map(button => (
          <button
            key={button.id}
            className={`btn btn-${button.style}`}
            onClick={() => onAction(button.action, { price: action_data.current_amount })}
          >
            {button.text}
          </button>
        ))}
      </div>
      
      {isFinalOffer && (
        <div className="final-offer-warning">
          ⚠️ This is the final offer. You can only accept or reject.
        </div>
      )}
    </div>
  );
};
```

## 🏗️ State Management

### Redux/Context State Structure

```javascript
const initialState = {
  conversations: {
    [conversationId]: {
      id: conversationId,
      flow_state: 'initial',
      awaiting_role: null,
      flow_data: {
        current_amount: 0,
        negotiation_count: 0,
        max_negotiations: 3,
        negotiation_history: [],
        price_agreed: false
      },
      messages: [],
      is_loading: false,
      error: null
    }
  },
  ui: {
    active_conversation: null,
    show_negotiation_modal: false,
    negotiation_input_value: '',
    is_submitting: false
  }
};
```

### State Management Actions

```javascript
// Action Types
const NEGOTIATION_ACTIONS = {
  // Conversation actions
  SET_CONVERSATION_STATE: 'SET_CONVERSATION_STATE',
  UPDATE_FLOW_DATA: 'UPDATE_FLOW_DATA',
  ADD_MESSAGE: 'ADD_MESSAGE',
  
  // UI actions
  SET_ACTIVE_CONVERSATION: 'SET_ACTIVE_CONVERSATION',
  TOGGLE_NEGOTIATION_MODAL: 'TOGGLE_NEGOTIATION_MODAL',
  SET_NEGOTIATION_INPUT: 'SET_NEGOTIATION_INPUT',
  SET_LOADING: 'SET_LOADING',
  SET_ERROR: 'SET_ERROR'
};

// Action Creators
const setConversationState = (conversationId, state) => ({
  type: NEGOTIATION_ACTIONS.SET_CONVERSATION_STATE,
  payload: { conversationId, state }
});

const updateFlowData = (conversationId, flowData) => ({
  type: NEGOTIATION_ACTIONS.UPDATE_FLOW_DATA,
  payload: { conversationId, flowData }
});

const addMessage = (conversationId, message) => ({
  type: NEGOTIATION_ACTIONS.ADD_MESSAGE,
  payload: { conversationId, message }
});
```

## 💻 Implementation Examples

### 1. Message Rendering Logic

```javascript
const renderMessage = (message) => {
  const { message_type, action_required, action_data } = message;
  
  if (action_required && action_data) {
    switch (action_data.message_type) {
      case 'brand_owner_negotiation_response':
        return <NegotiationRequestComponent message={message} onAction={handleButtonAction} />;
      
      case 'brand_owner_negotiation_input':
        return <PriceInputComponent action_data={action_data} onInput={handleTextInput} />;
      
      case 'influencer_final_price_response':
        return <FinalResponseComponent action_data={action_data} onAction={handleButtonAction} />;
      
      default:
        return <DefaultActionComponent message={message} onAction={handleButtonAction} />;
    }
  } else {
    return <TextMessageComponent message={message} />;
  }
};
```

### 2. Button Action Handler

```javascript
const handleButtonAction = async (buttonId, additionalData = {}) => {
  try {
    setLoading(true);
    
    const response = await fetch(`/api/messages/conversations/${conversationId}/button-click`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        button_id: buttonId,
        additional_data: additionalData
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update local state
      dispatch(setConversationState(conversationId, result.conversation_context));
      
      // Emit WebSocket event
      socket.emit('button_click', {
        conversationId,
        buttonId,
        additionalData
      });
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    dispatch(setError(error.message));
  } finally {
    setLoading(false);
  }
};
```

### 3. Text Input Handler

```javascript
const handleTextInput = async (inputType, data) => {
  try {
    setLoading(true);
    
    const response = await fetch(`/api/messages/conversations/${conversationId}/text-input`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        text: `₹${data.price}`,
        input_type: inputType,
        additional_data: data
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update local state
      dispatch(updateFlowData(conversationId, result.conversation_context.flow_data));
      
      // Emit WebSocket event
      socket.emit('text_input', {
        conversationId,
        text: `₹${data.price}`,
        inputType
      });
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    dispatch(setError(error.message));
  } finally {
    setLoading(false);
  }
};
```

### 4. WebSocket Event Handlers

```javascript
useEffect(() => {
  // Join conversation room
  socket.emit('join_conversation', conversationId);
  
  // Listen for new messages
  socket.on('new_message', (data) => {
    const { conversation_id, message, conversation_context } = data;
    
    if (conversation_id === conversationId) {
      dispatch(addMessage(conversationId, message));
      dispatch(setConversationState(conversationId, conversation_context));
    }
  });
  
  // Listen for state changes
  socket.on('conversation_state_changed', (data) => {
    const { conversation_id, new_state } = data;
    
    if (conversation_id === conversationId) {
      dispatch(setConversationState(conversationId, new_state));
    }
  });
  
  // Listen for button action responses
  socket.on('button_action', (data) => {
    const { button_id, message, flow_update, conversationId: convId } = data;
    
    if (convId === conversationId) {
      dispatch(addMessage(conversationId, message));
      if (flow_update) {
        dispatch(setConversationState(conversationId, flow_update));
      }
    }
  });
  
  // Cleanup
  return () => {
    socket.emit('leave_conversation', conversationId);
    socket.off('new_message');
    socket.off('conversation_state_changed');
    socket.off('button_action');
  };
}, [conversationId]);
```

## ⚠️ Error Handling

### Error Types

```javascript
const NEGOTIATION_ERRORS = {
  INVALID_PRICE: 'Invalid price amount',
  NEGOTIATION_LIMIT_REACHED: 'Maximum negotiation rounds reached',
  CONVERSATION_NOT_FOUND: 'Conversation not found',
  UNAUTHORIZED_ACTION: 'You are not authorized to perform this action',
  NETWORK_ERROR: 'Network error occurred',
  VALIDATION_ERROR: 'Input validation failed'
};
```

### Error Handling Implementation

```javascript
const handleError = (error, context) => {
  console.error('Negotiation Error:', error, context);
  
  let errorMessage = 'An unexpected error occurred';
  
  if (error.response) {
    // Server responded with error status
    const { status, data } = error.response;
    
    switch (status) {
      case 400:
        errorMessage = data.message || 'Invalid request';
        break;
      case 401:
        errorMessage = 'Unauthorized access';
        break;
      case 404:
        errorMessage = 'Conversation not found';
        break;
      case 500:
        errorMessage = 'Server error occurred';
        break;
      default:
        errorMessage = data.message || 'Request failed';
    }
  } else if (error.request) {
    // Network error
    errorMessage = 'Network error - please check your connection';
  }
  
  // Show error to user
  showErrorNotification(errorMessage);
  
  // Update state
  dispatch(setError(errorMessage));
};
```

## 🧪 Testing

### Unit Tests

```javascript
describe('Negotiation Flow', () => {
  test('should handle price input correctly', () => {
    const mockData = { price: 5000 };
    const result = handleTextInput('negotiation', mockData);
    expect(result).toBeDefined();
  });
  
  test('should validate price input', () => {
    expect(validatePrice(5000)).toBe(true);
    expect(validatePrice(-100)).toBe(false);
    expect(validatePrice(0)).toBe(false);
  });
  
  test('should render negotiation components correctly', () => {
    const mockMessage = {
      action_required: true,
      action_data: {
        message_type: 'brand_owner_negotiation_response',
        title: 'Negotiation Request',
        buttons: []
      }
    };
    
    const component = render(<NegotiationRequestComponent message={mockMessage} />);
    expect(component).toBeInTheDocument();
  });
});
```

### Integration Tests

```javascript
describe('Negotiation API Integration', () => {
  test('should handle button click API call', async () => {
    const mockResponse = {
      success: true,
      conversation_context: {
        flow_state: 'negotiation_input',
        awaiting_role: 'brand_owner'
      }
    };
    
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });
    
    const result = await handleButtonAction('negotiate_price', { price: 5000 });
    expect(result).toEqual(mockResponse);
  });
});
```

## 📱 Mobile Considerations

### Responsive Design

```css
/* Mobile-first approach */
.negotiation-request {
  padding: 16px;
  margin: 8px 0;
  border-radius: 8px;
  background: #f8f9fa;
}

.button-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (min-width: 768px) {
  .button-group {
    flex-direction: row;
  }
}

.price-input input {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px; /* Prevents zoom on iOS */
}
```

### Touch Interactions

```javascript
// Handle touch events for mobile
const handleTouchStart = (e) => {
  e.currentTarget.style.transform = 'scale(0.95)';
};

const handleTouchEnd = (e) => {
  e.currentTarget.style.transform = 'scale(1)';
};

// Apply to buttons
<button
  onTouchStart={handleTouchStart}
  onTouchEnd={handleTouchEnd}
  className="btn btn-primary"
>
  Negotiate Price
</button>
```

## 🔧 Configuration

### Environment Variables

```javascript
const config = {
  API_BASE_URL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000',
  WS_URL: process.env.REACT_APP_WS_URL || 'ws://localhost:3000',
  NEGOTIATION_LIMITS: {
    MAX_NEGOTIATIONS: 3,
    MIN_PRICE: 1,
    MAX_PRICE: 1000000
  },
  UI: {
    ANIMATION_DURATION: 300,
    DEBOUNCE_DELAY: 500
  }
};
```

### Feature Flags

```javascript
const FEATURE_FLAGS = {
  ENABLE_NEGOTIATION_HISTORY: true,
  ENABLE_PRICE_VALIDATION: true,
  ENABLE_REAL_TIME_UPDATES: true,
  ENABLE_PUSH_NOTIFICATIONS: true
};
```

## 📊 Analytics & Monitoring

### Event Tracking

```javascript
const trackNegotiationEvent = (event, data) => {
  analytics.track('negotiation_event', {
    event_type: event,
    conversation_id: data.conversationId,
    user_role: data.userRole,
    price: data.price,
    negotiation_round: data.negotiationRound,
    timestamp: new Date().toISOString()
  });
};

// Usage
trackNegotiationEvent('price_offered', {
  conversationId,
  userRole: 'influencer',
  price: 5000,
  negotiationRound: 1
});
```

### Performance Monitoring

```javascript
const measureNegotiationPerformance = (action, startTime) => {
  const duration = Date.now() - startTime;
  
  performance.mark(`negotiation_${action}_end`);
  performance.measure(
    `negotiation_${action}`,
    `negotiation_${action}_start`,
    `negotiation_${action}_end`
  );
  
  // Log slow operations
  if (duration > 1000) {
    console.warn(`Slow negotiation operation: ${action} took ${duration}ms`);
  }
};
```

## 🚀 Deployment Checklist

- [ ] All API endpoints are properly configured
- [ ] WebSocket connections are established correctly
- [ ] Error handling is implemented for all scenarios
- [ ] UI components are responsive and accessible
- [ ] State management is properly implemented
- [ ] Unit and integration tests are passing
- [ ] Performance monitoring is in place
- [ ] Analytics tracking is configured
- [ ] Mobile compatibility is verified
- [ ] Error boundaries are implemented

## 📚 Additional Resources

- [Backend API Documentation](./CHATTING_SYSTEM_GUIDE.md)
- [WebSocket Implementation Guide](./REALTIME_MESSAGING_GUIDE.md)
- [Database Schema](./database/schema.sql)
- [Error Handling Best Practices](./ERROR_HANDLING_GUIDE.md)

---

This document provides a complete implementation guide for the negotiation flow in the frontend. Follow the examples and patterns provided to ensure a robust, user-friendly negotiation system.
