# Frontend Chat System API Guide

## 🎯 Overview

This guide provides comprehensive API documentation for the frontend chat system. The backend handles all business logic, flow management, and automated conversations, while the frontend focuses on display and user interaction.

**Key Principle:** Frontend is display-only, all business logic resides in the backend.

---

## 🏗️ System Architecture

### Backend Responsibilities
- ✅ Business logic and flow management
- ✅ Automated conversation handling
- ✅ User authentication and authorization
- ✅ Database operations and state management
- ✅ WebSocket real-time updates
- ✅ Payment processing

### Frontend Responsibilities
- ✅ Display conversations and messages
- ✅ Render action buttons and forms
- ✅ Handle user input and API calls
- ✅ Real-time updates via WebSocket
- ✅ UI state management
- ✅ Error handling and user feedback

---

## 🔐 Authentication

### JWT Token Required
All API endpoints require a valid JWT token in the Authorization header:

```typescript
const headers = {
  'Authorization': `Bearer ${jwtToken}`,
  'Content-Type': 'application/json'
};
```

### Role-Based Access
- **Brand Owners:** Can manage their bids and campaigns
- **Influencers:** Can apply to bids and respond to offers
- **Admins:** Full access to all endpoints

---

## 📱 Core Chat Endpoints

### 1. Get User Conversations
```typescript
GET /api/messages/conversations
```

**Purpose:** Fetch all conversations for the authenticated user

**Query Parameters:**
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Items per page (default: 10)

**Response:**
```typescript
{
  success: boolean;
  data: {
    conversations: Conversation[];
    pagination: {
      current_page: number;
      total_pages: number;
      total_count: number;
      has_next: boolean;
      has_prev: boolean;
    };
  };
}

interface Conversation {
  id: string;
  brand_owner_id: string;
  influencer_id: string;
  chat_status: 'active' | 'archived' | 'completed';
  campaign_id?: string;
  bid_id?: string;
  created_at: string;
  updated_at: string;
  flow_state?: string;
  awaiting_role?: string;
  campaigns?: {
    id: string;
    title: string;
    description: string;
    budget: number;
    status: string;
  };
  bids?: {
    id: string;
    title: string;
    description: string;
    min_budget: number;
    max_budget: number;
    status: string;
  };
}
```

**Frontend Usage:**
```typescript
const fetchConversations = async (page = 1, limit = 10) => {
  const response = await fetch(`/api/messages/conversations?page=${page}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.json();
};
```

### 2. Get Direct Conversations
```typescript
GET /api/messages/conversations/direct
```

**Purpose:** Fetch only direct conversations (no campaigns/bids)

**Response:** Same structure as conversations but filtered for direct chats only.

### 3. Get Conversation Messages
```typescript
GET /api/messages/conversations/:conversation_id/messages
```

**Purpose:** Fetch all messages for a specific conversation

**Query Parameters:**
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Messages per page (default: 50)

**Response:**
```typescript
{
  success: boolean;
  data: {
    messages: Message[];
    conversation: Conversation;
    pagination: {
      current_page: number;
      total_pages: number;
      total_count: number;
      has_next: boolean;
      has_prev: boolean;
    };
  };
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: 'text' | 'automated' | 'button' | 'input' | 'action';
  metadata?: {
    action_type?: string;
    action_data?: any;
    button_text?: string;
    input_placeholder?: string;
    flow_state?: string;
  };
  created_at: string;
  is_read: boolean;
}
```

### 4. Send Message
```typescript
POST /api/messages/conversations/:conversation_id/messages
```

**Purpose:** Send a new message to a conversation

**Request Body:**
```typescript
{
  content: string;
  message_type?: 'text' | 'automated' | 'button' | 'input' | 'action';
  metadata?: {
    action_type?: string;
    action_data?: any;
    button_text?: string;
    input_placeholder?: string;
  };
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    message: Message;
    conversation: Conversation;
  };
}
```

### 5. Handle Button Click
```typescript
POST /api/messages/conversations/:conversation_id/button-click
```

**Purpose:** Handle automated flow button clicks

**Request Body:**
```typescript
{
  button_type: string;
  button_data: any;
  flow_context?: any;
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    action_result: any;
    next_flow_state: string;
    new_messages: Message[];
    conversation: Conversation;
  };
}
```

### 6. Handle Text Input
```typescript
POST /api/messages/conversations/:conversation_id/text-input
```

**Purpose:** Handle automated flow text inputs

**Request Body:**
```typescript
{
  input_type: string;
  input_value: string;
  flow_context?: any;
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    input_result: any;
    next_flow_state: string;
    new_messages: Message[];
    conversation: Conversation;
  };
}
```

---

## 🚀 Automated Bid Flow Endpoints

### 1. Initialize Bid Conversation
```typescript
POST /api/bids/automated/initialize
```

**Purpose:** Start automated conversation for a bid application

**Required Role:** Brand Owner or Admin

**Request Body:**
```typescript
{
  bid_id: string;
  influencer_id: string;
  initial_message?: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    conversation: Conversation;
    flow_state: string;
    awaiting_role: string;
    automated_messages: Message[];
  };
}
```

### 2. Brand Owner Action
```typescript
POST /api/bids/automated/brand-owner-action
```

**Purpose:** Handle brand owner actions in automated flow

**Required Role:** Brand Owner or Admin

**Request Body:**
```typescript
{
  conversation_id: string;
  action_type: 'accept' | 'negotiate' | 'ask_question' | 'reject';
  action_data?: {
    proposed_amount?: number;
    question?: string;
    reason?: string;
  };
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    action_result: any;
    next_flow_state: string;
    awaiting_role: string;
    new_messages: Message[];
    conversation: Conversation;
  };
}
```

### 3. Influencer Action
```typescript
POST /api/bids/automated/influencer-action
```

**Purpose:** Handle influencer actions in automated flow

**Required Role:** Influencer

**Request Body:**
```typescript
{
  conversation_id: string;
  action_type: 'accept' | 'reject' | 'respond_question' | 'propose_amount';
  action_data?: {
    proposed_amount?: number;
    answer?: string;
    reason?: string;
  };
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    action_result: any;
    next_flow_state: string;
    awaiting_role: string;
    new_messages: Message[];
    conversation: Conversation;
  };
}
```

### 4. Final Confirmation
```typescript
POST /api/bids/automated/final-confirmation
```

**Purpose:** Final confirmation to proceed to payment

**Required Role:** Brand Owner or Admin

**Request Body:**
```typescript
{
  conversation_id: string;
  confirm: boolean;
  payment_method?: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    payment_initiated: boolean;
    payment_url?: string;
    conversation: Conversation;
  };
}
```

### 5. Get Flow Context
```typescript
GET /api/bids/automated/conversation/:conversation_id/context
```

**Purpose:** Get current flow state and context

**Response:**
```typescript
{
  success: boolean;
  data: {
    flow_state: string;
    awaiting_role: string;
    flow_data: any;
    negotiation_round: number;
    final_price?: number;
    can_proceed: boolean;
    available_actions: string[];
  };
}
```

---

## 🔄 Flow States & Transitions

### Flow State Machine
```typescript
enum FlowState {
  INITIAL = 'initial',
  INFLUENCER_RESPONDING = 'influencer_responding',
  BRAND_OWNER_CONFIRMING = 'brand_owner_confirming',
  NEGOTIATING = 'negotiating',
  QUESTION_PENDING = 'question_pending',
  PAYMENT_PENDING = 'payment_pending',
  COMPLETED = 'completed',
  DECLINED = 'declined'
}
```

### State Transitions
```typescript
const flowTransitions = {
  initial: {
    next: ['influencer_responding'],
    actions: ['brand_owner_action']
  },
  influencer_responding: {
    next: ['brand_owner_confirming', 'negotiating', 'question_pending'],
    actions: ['influencer_action']
  },
  brand_owner_confirming: {
    next: ['payment_pending', 'completed'],
    actions: ['brand_owner_action']
  },
  negotiating: {
    next: ['influencer_responding'],
    actions: ['brand_owner_action']
  },
  question_pending: {
    next: ['influencer_responding'],
    actions: ['influencer_action']
  },
  payment_pending: {
    next: ['completed'],
    actions: ['brand_owner_action']
  }
};
```

---

## 💬 Message Types & Rendering

### 1. Text Messages
```typescript
interface TextMessage {
  message_type: 'text';
  content: string;
  sender_id: string;
  created_at: string;
}
```

**Frontend Rendering:**
```typescript
const renderTextMessage = (message: TextMessage) => (
  <div className="message text-message">
    <div className="message-content">{message.content}</div>
    <div className="message-time">{formatTime(message.created_at)}</div>
  </div>
);
```

### 2. Automated Messages
```typescript
interface AutomatedMessage {
  message_type: 'automated';
  content: string;
  metadata: {
    flow_state: string;
    action_required: boolean;
    awaiting_role: string;
  };
}
```

**Frontend Rendering:**
```typescript
const renderAutomatedMessage = (message: AutomatedMessage) => (
  <div className="message automated-message">
    <div className="message-content">{message.content}</div>
    <div className="flow-status">
      Status: {message.metadata.flow_state}
    </div>
  </div>
);
```

### 3. Action Messages
```typescript
interface ActionMessage {
  message_type: 'action';
  content: string;
  metadata: {
    action_type: string;
    action_data: any;
    button_text: string;
    input_placeholder?: string;
  };
}
```

**Frontend Rendering:**
```typescript
const renderActionMessage = (message: ActionMessage, onAction: Function) => (
  <div className="message action-message">
    <div className="message-content">{message.content}</div>
    <div className="action-buttons">
      <button onClick={() => onAction(message.metadata)}>
        {message.metadata.button_text}
      </button>
    </div>
  </div>
);
```

---

## 🔌 WebSocket Integration

### Connection Setup
```typescript
const setupWebSocket = (userId: string, token: string) => {
  const ws = new WebSocket(`ws://localhost:3000?token=${token}&userId=${userId}`);
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };
  
  return ws;
};
```

### Message Types
```typescript
interface WebSocketMessage {
  type: 'new_message' | 'flow_update' | 'status_change' | 'payment_update';
  data: any;
  conversation_id: string;
  timestamp: string;
}
```

### Real-time Updates
```typescript
const handleWebSocketMessage = (message: WebSocketMessage) => {
  switch (message.type) {
    case 'new_message':
      addMessageToConversation(message.data);
      break;
    case 'flow_update':
      updateFlowState(message.data);
      break;
    case 'status_change':
      updateConversationStatus(message.data);
      break;
    case 'payment_update':
      handlePaymentUpdate(message.data);
      break;
  }
};
```

---

## 🎨 Frontend Component Structure

### 1. Conversation List
```typescript
const ConversationList = () => {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    fetchConversations();
  }, []);
  
  return (
    <div className="conversation-list">
      {conversations.map(conv => (
        <ConversationItem 
          key={conv.id} 
          conversation={conv}
          onClick={() => selectConversation(conv.id)}
        />
      ))}
    </div>
  );
};
```

### 2. Message Thread
```typescript
const MessageThread = ({ conversationId }) => {
  const [messages, setMessages] = useState([]);
  const [flowState, setFlowState] = useState(null);
  
  useEffect(() => {
    fetchMessages(conversationId);
    fetchFlowContext(conversationId);
  }, [conversationId]);
  
  return (
    <div className="message-thread">
      <FlowStatus flowState={flowState} />
      <MessageList messages={messages} />
      <MessageInput onSend={sendMessage} />
    </div>
  );
};
```

### 3. Flow Status Component
```typescript
const FlowStatus = ({ flowState }) => {
  if (!flowState) return null;
  
  return (
    <div className="flow-status-bar">
      <div className="status-indicator">
        Status: {flowState.flow_state}
      </div>
      <div className="awaiting-role">
        Waiting for: {flowState.awaiting_role}
      </div>
      {flowState.available_actions.length > 0 && (
        <div className="available-actions">
          Available: {flowState.available_actions.join(', ')}
        </div>
      )}
    </div>
  );
};
```

---

## 🚨 Error Handling

### API Error Response Format
```typescript
interface ApiError {
  success: false;
  message: string;
  error_code?: string;
  details?: any;
  suggestion?: string;
}
```

### Frontend Error Handling
```typescript
const handleApiError = (error: ApiError) => {
  switch (error.error_code) {
    case 'UNAUTHORIZED':
      redirectToLogin();
      break;
    case 'FORBIDDEN':
      showAccessDenied();
      break;
    case 'NOT_FOUND':
      showNotFound();
      break;
    case 'VALIDATION_ERROR':
      showValidationErrors(error.details);
      break;
    default:
      showGenericError(error.message);
  }
};
```

### Network Error Handling
```typescript
const apiCall = async (url: string, options: RequestInit) => {
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.json();
      throw error;
    }
    
    return await response.json();
  } catch (error) {
    if (error.name === 'TypeError') {
      // Network error
      showNetworkError();
    } else {
      // API error
      handleApiError(error);
    }
    throw error;
  }
};
```

---

## 📱 Mobile Responsiveness

### Breakpoint Strategy
```typescript
const breakpoints = {
  mobile: 'max-width: 768px',
  tablet: 'max-width: 1024px',
  desktop: 'min-width: 1025px'
};
```

### Responsive Components
```typescript
const useResponsive = () => {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  return { isMobile };
};
```

---

## 🧪 Testing Strategy

### 1. API Testing
```typescript
describe('Chat API Endpoints', () => {
  test('should fetch conversations', async () => {
    const response = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${validToken}`);
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

### 2. Component Testing
```typescript
describe('MessageThread Component', () => {
  test('should render messages correctly', () => {
    const { getByText } = render(<MessageThread conversationId="123" />);
    expect(getByText('Test Message')).toBeInTheDocument();
  });
});
```

### 3. Integration Testing
```typescript
describe('Chat Flow Integration', () => {
  test('should handle complete conversation flow', async () => {
    // Test complete flow from initialization to completion
  });
});
```

---

## 🚀 Performance Optimization

### 1. Message Pagination
```typescript
const useMessagePagination = (conversationId: string) => {
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  
  const loadMore = async () => {
    if (!hasMore) return;
    
    const newMessages = await fetchMessages(conversationId, page + 1);
    setMessages(prev => [...prev, ...newMessages]);
    setPage(prev => prev + 1);
    setHasMore(newMessages.length === 50); // Assuming 50 is the limit
  };
  
  return { messages, hasMore, loadMore };
};
```

### 2. Virtual Scrolling
```typescript
import { FixedSizeList as List } from 'react-window';

const VirtualizedMessageList = ({ messages }) => (
  <List
    height={600}
    itemCount={messages.length}
    itemSize={80}
    itemData={messages}
  >
    {({ index, style, data }) => (
      <MessageItem
        message={data[index]}
        style={style}
      />
    )}
  </List>
);
```

### 3. Debounced API Calls
```typescript
import { debounce } from 'lodash';

const debouncedSearch = useMemo(
  () => debounce((query: string) => {
    searchConversations(query);
  }, 300),
  []
);
```

---

## 🔧 Configuration & Environment

### Environment Variables
```typescript
const config = {
  apiBaseUrl: process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000',
  wsUrl: process.env.REACT_APP_WS_URL || 'ws://localhost:3000',
  environment: process.env.NODE_ENV || 'development',
  debug: process.env.REACT_APP_DEBUG === 'true'
};
```

### API Client Configuration
```typescript
class ApiClient {
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json'
    };
  }
  
  setAuthToken(token: string) {
    this.defaultHeaders.Authorization = `Bearer ${token}`;
  }
  
  async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers
      }
    };
    
    return fetch(url, config);
  }
}
```

---

## 📚 Complete Integration Example

### Main Chat Component
```typescript
const ChatSystem = () => {
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversations, setConversations] = useState([]);
  const { user } = useAuth();
  
  useEffect(() => {
    if (user) {
      fetchConversations();
      setupWebSocket(user.id, user.token);
    }
  }, [user]);
  
  return (
    <div className="chat-system">
      <div className="sidebar">
        <ConversationList
          conversations={conversations}
          onSelect={setSelectedConversation}
        />
      </div>
      <div className="main-content">
        {selectedConversation ? (
          <MessageThread conversationId={selectedConversation.id} />
        ) : (
          <div className="no-conversation">
            Select a conversation to start chatting
          </div>
        )}
      </div>
    </div>
  );
};
```

---

## 🎯 Key Takeaways

1. **Backend Handles Everything:** All business logic, flow management, and state transitions
2. **Frontend is Display-Only:** Renders UI, handles user input, makes API calls
3. **Real-time Updates:** WebSocket integration for live conversation updates
4. **Role-Based Access:** Different endpoints for different user roles
5. **Automated Flows:** Complete bid/campaign flow automation
6. **Responsive Design:** Mobile-first approach with breakpoint strategy
7. **Error Handling:** Comprehensive error handling at all levels
8. **Performance:** Pagination, virtual scrolling, and debounced calls

---

## 🚀 Next Steps

1. **Implement Frontend Components** using the provided structure
2. **Set up WebSocket Connection** for real-time updates
3. **Add Error Boundaries** and loading states
4. **Implement Responsive Design** for mobile devices
5. **Add Unit Tests** for components and API calls
6. **Set up Monitoring** for performance and errors
7. **Deploy and Test** in staging environment

The backend is fully ready to support a sophisticated frontend chat system with automated flows, real-time updates, and comprehensive business logic handling.
