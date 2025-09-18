# Complete Chatting System Guide

## Overview

The Stoory backend implements a sophisticated real-time chatting system with automated workflows for influencer-brand collaborations. The system supports multiple conversation types, automated flow management, and real-time communication via WebSockets.

## System Architecture

### Core Components

1. **MessageHandler** (`sockets/messageHandler.js`) - WebSocket event handling
2. **AutomatedFlowService** (`services/automatedFlowService.js`) - Automated conversation flows
3. **MessageController** (`controllers/messageController.js`) - REST API for messages
4. **Database Schema** - PostgreSQL with Supabase

### Technology Stack

- **Backend**: Node.js + Express
- **Real-time**: Socket.IO
- **Database**: PostgreSQL (Supabase)
- **Authentication**: JWT tokens
- **Payment**: Razorpay integration

## Database Schema

### Core Tables

#### `conversations`
```sql
CREATE TABLE conversations (
    id UUID PRIMARY KEY,
    campaign_id UUID REFERENCES campaigns(id),
    bid_id UUID REFERENCES bids(id),
    brand_owner_id UUID NOT NULL REFERENCES users(id),
    influencer_id UUID NOT NULL REFERENCES users(id),
    request_id UUID REFERENCES requests(id),
    chat_status TEXT, -- 'automated', 'real_time', 'closed'
    flow_state TEXT, -- 'influencer_responding', 'payment_pending', etc.
    awaiting_role TEXT, -- 'influencer', 'brand_owner', null
    automation_enabled BOOLEAN DEFAULT false,
    current_action_data JSONB,
    flow_data JSONB,
    work_submission JSONB,
    work_submitted BOOLEAN DEFAULT false,
    work_status TEXT,
    submission_date TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### `messages`
```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    sender_id UUID NOT NULL REFERENCES users(id),
    receiver_id UUID NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    media_url TEXT,
    message_type TEXT, -- 'user_input', 'system', 'automated', 'audit'
    action_required BOOLEAN DEFAULT false,
    action_data JSONB,
    is_automated BOOLEAN DEFAULT false,
    action_completed BOOLEAN DEFAULT false,
    seen BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Conversation Types

### 1. Direct Conversations
- **Purpose**: Direct communication between users
- **Flow**: Real-time chat only
- **No automation**: Manual messaging
- **Use case**: General communication

### 2. Campaign Conversations
- **Purpose**: Brand owner posts campaign, influencers apply
- **Flow**: Application → Review → Negotiation → Payment → Work → Completion
- **Automation**: Full automated workflow
- **Use case**: Structured campaign management

### 3. Bid Conversations
- **Purpose**: Influencer posts bid, brand owners connect
- **Flow**: Connection → Project Details → Pricing → Payment → Work → Completion
- **Automation**: Full automated workflow
- **Use case**: Influencer-driven collaborations

## Automated Flow States

### Flow State Machine

```
initial
├── influencer_responding (influencer needs to accept/reject)
├── brand_owner_details (brand owner provides project details)
├── influencer_reviewing (influencer reviews requirements)
├── brand_owner_pricing (brand owner sets price)
├── influencer_price_response (influencer responds to price)
├── brand_owner_negotiation (brand owner handles negotiation)
├── influencer_final_response (final influencer decision)
├── negotiation_input (price negotiation input)
├── payment_pending (awaiting payment)
├── payment_completed (payment completed, ready to start work)
├── work_in_progress (work has started)
├── work_submitted (influencer submitted work)
├── work_approved (work completed)
├── real_time (real-time chat enabled - after work completion)
└── chat_closed (conversation ended)
```

### Awaiting Role System

- **`influencer`**: Influencer needs to take action
- **`brand_owner`**: Brand owner needs to take action
- **`null`**: No action required (conversation closed or completed)

### Correct Flow Sequence

The payment and work flow follows this specific sequence:

1. **Payment Pending** → User initiates payment
2. **Payment Completed** → Payment webhook confirms payment success
3. **Work In Progress** → Influencer starts working (after payment completion)
4. **Work Submitted** → Influencer submits completed work
5. **Work Approved** → Brand owner approves work
6. **Real-time Chat** → Both parties can communicate freely (after work completion)

**Important**: Real-time chat is only enabled AFTER work completion, not before. This ensures structured collaboration with clear phases.

## Real-time Communication

### WebSocket Events

#### Client → Server Events

```javascript
// Join user room
socket.emit('join', userId);

// Join conversation room
socket.emit('join_conversation', conversationId);

// Leave conversation room
socket.emit('leave_conversation', conversationId);

// Send message
socket.emit('send_message', {
    conversationId,
    senderId,
    receiverId,
    message,
    mediaUrl
});

// Typing indicators
socket.emit('typing_start', { conversationId, userId });
socket.emit('typing_stop', { conversationId, userId });

// Mark message as seen
socket.emit('mark_seen', { messageId, userId, conversationId });

// User status
socket.emit('user_status', { userId, status });

// Join specific rooms
socket.emit('join_bid_room', bidId);
socket.emit('join_campaign_room', campaignId);
```

#### Server → Client Events

```javascript
// New message received
socket.on('new_message', (data) => {
    // data: { conversation_id, message, conversation_context }
});

// User notification
socket.on('notification', (data) => {
    // data: { type, data: { conversation_id, message, sender_id, etc. } }
});

// User typing indicator
socket.on('user_typing', (data) => {
    // data: { conversationId, userId, isTyping }
});

// Message seen status
socket.on('message_seen', (data) => {
    // data: { messageId, userId }
});

// Conversation state change
socket.on('conversation_state_changed', (data) => {
    // data: { conversation_id, previous_state, new_state, reason, timestamp }
});

// Button action response
socket.on('button_action', (data) => {
    // data: { button_id, message, flow_update, conversationId, conversation_context }
});

// Text input response
socket.on('text_input', (data) => {
    // data: { input_type, message, flow_update, conversationId }
});

// User status changes
socket.on('user_status_change', (data) => {
    // data: { userId, status }
});

socket.on('user_offline', (data) => {
    // data: { userId }
});
```

### Room Management

#### User Rooms
- **Format**: `user_${userId}`
- **Purpose**: Send notifications to specific users
- **Usage**: Personal notifications, direct messages

#### Conversation Rooms
- **Format**: `conversation_${conversationId}`
- **Purpose**: Real-time updates for conversation participants
- **Usage**: New messages, state changes, typing indicators

#### Specialized Rooms
- **Bid Rooms**: `bid_${bidId}` - Updates for specific bids
- **Campaign Rooms**: `campaign_${campaignId}` - Updates for specific campaigns

## Message Types

### 1. User Input Messages
- **Type**: `user_input`
- **Purpose**: Regular user messages
- **Features**: Manual typing, media support
- **Action Required**: Usually false

### 2. System Messages
- **Type**: `system`
- **Purpose**: System-generated messages
- **Features**: Automated content, action buttons
- **Action Required**: Often true

### 3. Automated Messages
- **Type**: `automated`
- **Purpose**: Flow-driven messages
- **Features**: Structured responses, state transitions
- **Action Required**: Usually true

### 4. Audit Messages
- **Type**: `audit`
- **Purpose**: Action confirmation for one user
- **Features**: Internal tracking, not shown to other user
- **Action Required**: Always false

## Action Data Structure

### Button Actions
```javascript
{
    title: "Action Title",
    subtitle: "Action description",
    buttons: [
        {
            id: "action_id",
            text: "Button Text",
            style: "success|danger|warning|primary|secondary",
            action: "action_name",
            data: {} // Optional additional data
        }
    ],
    flow_state: "current_flow_state",
    message_type: "message_type",
    visible_to: "influencer|brand_owner"
}
```

### Input Fields
```javascript
{
    title: "Input Title",
    subtitle: "Input description",
    input_field: {
        id: "field_id",
        type: "text|number|textarea|email",
        placeholder: "Placeholder text",
        required: true,
        min: 1,
        maxLength: 1000
    },
    submit_button: {
        text: "Submit",
        style: "success"
    }
}
```

### Payment Integration
```javascript
{
    payment_order: {
        razorpay_config: {
            order_id: "order_123",
            amount: 5000, // in paise
            currency: "INR",
            key_id: "rzp_test_...",
            name: "Stoory Platform",
            description: "Payment for Campaign Collaboration",
            prefill: {
                name: "User Name",
                email: "user@example.com",
                contact: "9876543210"
            },
            theme: {
                color: "#3B82F6"
            }
        }
    }
}
```

## API Endpoints

### Message Management

#### Get Conversations
```http
GET /api/messages/conversations
Query: ?page=1&limit=10
Headers: Authorization: Bearer <token>
```

#### Get Messages
```http
GET /api/messages/conversations/:conversation_id/messages
Query: ?page=1&limit=50
Headers: Authorization: Bearer <token>
```

#### Send Message
```http
POST /api/messages/send
Body: {
    "conversation_id": "uuid",
    "message": "Hello!",
    "media_url": "https://...",
    "receiver_id": "uuid" // for new conversations
}
Headers: Authorization: Bearer <token>
```

#### Mark Messages as Seen
```http
POST /api/messages/conversations/:conversation_id/seen
Headers: Authorization: Bearer <token>
```

#### Get Unread Count
```http
GET /api/messages/unread-count
Headers: Authorization: Bearer <token>
```

### Direct Connections

#### Initiate Direct Connect
```http
POST /api/messages/direct-connect
Body: {
    "target_user_id": "uuid",
    "initial_message": "Hello!"
}
Headers: Authorization: Bearer <token>
```

#### Get Direct Connections
```http
GET /api/messages/direct-connections
Query: ?page=1&limit=10
Headers: Authorization: Bearer <token>
```

### Conversation Context

#### Get Conversation Context
```http
GET /api/messages/conversations/:conversation_id/context
Headers: Authorization: Bearer <token>
```

#### Handle Button Click
```http
POST /api/messages/conversations/:conversation_id/button-click
Body: {
    "button_id": "accept_connection",
    "additional_data": {}
}
Headers: Authorization: Bearer <token>
```

#### Handle Text Input
```http
POST /api/messages/conversations/:conversation_id/text-input
Body: {
    "text": "₹5000",
    "input_type": "negotiation"
}
Headers: Authorization: Bearer <token>
```

## Automated Flow Examples

### 1. Bid Connection Flow

```javascript
// 1. Initialize conversation
const result = await automatedFlowService.initializeBidConversation(
    bidId, 
    influencerId, 
    proposedAmount
);

// 2. Influencer accepts connection
await automatedFlowService.handleInfluencerAction(
    conversationId, 
    'accept_connection'
);

// 3. Brand owner sends project details
await automatedFlowService.handleBrandOwnerAction(
    conversationId, 
    'send_project_details', 
    { details: "Create 3 Instagram posts..." }
);

// 4. Influencer accepts project
await automatedFlowService.handleInfluencerAction(
    conversationId, 
    'accept_project'
);

// 5. Brand owner sends price offer
await automatedFlowService.handleBrandOwnerAction(
    conversationId, 
    'send_price_offer', 
    { price: 5000 }
);

// 6. Influencer accepts price
await automatedFlowService.handleInfluencerAction(
    conversationId, 
    'accept_price', 
    { price: 5000 }
);

// 7. Brand owner proceeds to payment
await automatedFlowService.handleBrandOwnerAction(
    conversationId, 
    'proceed_to_payment'
);

// 8. Payment completion (called by payment webhook)
await automatedFlowService.handlePaymentCompletion(
    conversationId, 
    { amount: 5000 }
);

// 9. Influencer starts work
await automatedFlowService.handleInfluencerAction(
    conversationId, 
    'start_work'
);
```

### 2. Work Submission Flow

```javascript
// 1. Influencer submits work
await automatedFlowService.handleWorkSubmission(conversationId, {
    deliverables: "https://drive.google.com/...",
    description: "3 Instagram posts as requested",
    submission_notes: "All posts follow brand guidelines",
    submitted_at: new Date().toISOString()
});

// 2. Brand owner approves work (transitions to real_time)
await automatedFlowService.handleWorkReview(
    conversationId, 
    'approve_work', 
    'Excellent work!'
);

// OR

// 2. Brand owner requests revision
await automatedFlowService.handleWorkReview(
    conversationId, 
    'request_revision', 
    'Please adjust the color scheme'
);
```

## Frontend Integration

### Socket.IO Client Setup

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:5000', {
    auth: {
        token: localStorage.getItem('authToken')
    }
});

// Join user room
socket.emit('join', userId);

// Join conversation room
socket.emit('join_conversation', conversationId);

// Listen for new messages
socket.on('new_message', (data) => {
    const { conversation_id, message, conversation_context } = data;
    // Update UI with new message
    updateMessageList(conversation_id, message);
    updateConversationContext(conversation_id, conversation_context);
});

// Listen for notifications
socket.on('notification', (data) => {
    // Show notification to user
    showNotification(data);
});

// Send message
function sendMessage(conversationId, message, mediaUrl = null) {
    socket.emit('send_message', {
        conversationId,
        senderId: currentUserId,
        receiverId: otherUserId,
        message,
        mediaUrl
    });
}

// Handle button clicks
function handleButtonClick(conversationId, buttonId, additionalData = {}) {
    fetch(`/api/messages/conversations/${conversationId}/button-click`, {
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
}
```

### Message Rendering

```javascript
function renderMessage(message) {
    const { message_type, action_required, action_data } = message;
    
    if (action_required && action_data) {
        return renderActionMessage(message);
    } else {
        return renderTextMessage(message);
    }
}

function renderActionMessage(message) {
    const { action_data } = message;
    
    return (
        <div className="action-message">
            <h4>{action_data.title}</h4>
            <p>{action_data.subtitle}</p>
            
            {action_data.buttons && (
                <div className="action-buttons">
                    {action_data.buttons.map(button => (
                        <button
                            key={button.id}
                            className={`btn btn-${button.style}`}
                            onClick={() => handleButtonClick(button.id)}
                        >
                            {button.text}
                        </button>
                    ))}
                </div>
            )}
            
            {action_data.input_field && (
                <div className="input-field">
                    <input
                        type={action_data.input_field.type}
                        placeholder={action_data.input_field.placeholder}
                        required={action_data.input_field.required}
                    />
                    <button onClick={handleInputSubmit}>
                        {action_data.submit_button.text}
                    </button>
                </div>
            )}
        </div>
    );
}
```

## Error Handling

### Common Error Scenarios

1. **Socket Connection Lost**
   - Implement reconnection logic
   - Show connection status to user
   - Queue messages for retry

2. **Message Send Failures**
   - Retry mechanism with exponential backoff
   - Show error messages to user
   - Fallback to REST API

3. **Flow State Errors**
   - Validate current state before actions
   - Show appropriate error messages
   - Allow state recovery

### Error Response Format

```javascript
{
    "success": false,
    "message": "Error description",
    "error_code": "FLOW_STATE_INVALID",
    "details": {
        "current_state": "payment_pending",
        "required_state": "influencer_price_response"
    }
}
```

## Performance Considerations

### Database Optimization

1. **Indexes**: Proper indexing on conversation_id, sender_id, receiver_id
2. **Pagination**: Limit message queries to prevent large data loads
3. **Caching**: Cache conversation context and user details
4. **Connection Pooling**: Efficient database connection management

### Real-time Optimization

1. **Room Management**: Only join necessary rooms
2. **Message Batching**: Batch multiple updates when possible
3. **Connection Limits**: Implement rate limiting for socket events
4. **Memory Management**: Clean up unused room subscriptions

## Security Considerations

### Authentication & Authorization

1. **JWT Validation**: Verify tokens on socket connection
2. **Room Access Control**: Ensure users can only join authorized rooms
3. **Message Validation**: Sanitize and validate all message content
4. **Rate Limiting**: Prevent spam and abuse

### Data Protection

1. **Message Encryption**: Consider end-to-end encryption for sensitive data
2. **Media Validation**: Validate and sanitize media URLs
3. **SQL Injection**: Use parameterized queries
4. **XSS Prevention**: Sanitize user input

## Monitoring & Analytics

### Key Metrics

1. **Connection Metrics**: Active connections, reconnection rates
2. **Message Metrics**: Messages per second, delivery rates
3. **Flow Metrics**: State transition success rates
4. **Error Metrics**: Error rates by type and endpoint

### Logging

```javascript
// Example logging structure
{
    "timestamp": "2024-01-15T10:30:00Z",
    "level": "info",
    "service": "message_handler",
    "event": "message_sent",
    "conversation_id": "uuid",
    "user_id": "uuid",
    "message_type": "user_input",
    "flow_state": "real_time"
}
```

## Testing

### Unit Tests

1. **Message Handler**: Test socket event handling
2. **Flow Service**: Test state transitions
3. **Controller**: Test API endpoints
4. **Database**: Test CRUD operations

### Integration Tests

1. **End-to-End Flows**: Complete conversation flows
2. **Real-time Events**: Socket.IO event testing
3. **Payment Integration**: Razorpay flow testing
4. **Error Scenarios**: Failure handling

### Load Testing

1. **Concurrent Connections**: Test with multiple users
2. **Message Throughput**: High-volume message testing
3. **Database Performance**: Query optimization under load
4. **Memory Usage**: Monitor memory consumption

## Deployment

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Socket.IO
CORS_ORIGIN=http://localhost:3000,https://yourdomain.com

# Payment
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...

# System
SYSTEM_USER_ID=00000000-0000-0000-0000-000000000000
NODE_ENV=production
```

### Docker Configuration

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["node", "index.js"]
```

This comprehensive guide covers all aspects of the chatting system, from database design to frontend integration. The system provides a robust foundation for real-time communication with automated workflows, making it suitable for complex collaboration management between influencers and brand owners.
