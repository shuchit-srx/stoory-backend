# API Endpoints Quick Reference

## 🚀 Quick Start

**Base URL:** `https://your-api-domain.com`  
**Authentication:** All endpoints require `Authorization: Bearer <JWT_TOKEN>` header  
**Content-Type:** `application/json`

---

## 📱 Chat System Endpoints

### Conversations
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `GET` | `/api/messages/conversations` | Get user conversations | Any authenticated |
| `GET` | `/api/messages/conversations/direct` | Get direct conversations only | Any authenticated |
| `GET` | `/api/messages/conversations/:id/messages` | Get conversation messages | Conversation participant |
| `POST` | `/api/messages/conversations/:id/messages` | Send message | Conversation participant |
| `PUT` | `/api/messages/conversations/:id/seen` | Mark as seen | Conversation participant |

### Automated Actions
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `POST` | `/api/messages/conversations/:id/button-click` | Handle button clicks | Conversation participant |
| `POST` | `/api/messages/conversations/:id/text-input` | Handle text inputs | Conversation participant |

### Direct Messaging
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `POST` | `/api/messages/direct-connect` | Start direct conversation | Any authenticated |
| `GET` | `/api/messages/direct-connections` | Get direct connections | Any authenticated |
| `POST` | `/api/messages/direct-message` | Send direct message | Any authenticated |

---

## 🎯 Automated Bid Flow Endpoints

### Flow Management
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `POST` | `/api/bids/automated/initialize` | Start automated conversation | Brand Owner/Admin |
| `POST` | `/api/bids/automated/brand-owner-action` | Handle brand owner actions | Brand Owner/Admin |
| `POST` | `/api/bids/automated/influencer-action` | Handle influencer actions | Influencer |
| `POST` | `/api/bids/automated/final-confirmation` | Final confirmation | Brand Owner/Admin |
| `GET` | `/api/bids/automated/conversation/:id/context` | Get flow context | Conversation participant |

---

## 🏗️ Bid Management Endpoints

### CRUD Operations
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `POST` | `/api/bids` | Create new bid | Brand Owner/Admin |
| `GET` | `/api/bids` | Get all bids | Any authenticated |
| `GET` | `/api/bids/stats` | Get bid statistics | Any authenticated |
| `GET` | `/api/bids/:id` | Get specific bid | Any authenticated |
| `PUT` | `/api/bids/:id` | Update bid | Brand Owner/Admin |
| `DELETE` | `/api/bids/:id` | Delete bid | Brand Owner/Admin |

---

## 🎬 Campaign Management Endpoints

### Campaign Operations
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `POST` | `/api/campaigns` | Create campaign | Brand Owner/Admin |
| `GET` | `/api/campaigns` | Get campaigns | Any authenticated |
| `GET` | `/api/campaigns/:id` | Get specific campaign | Any authenticated |
| `PUT` | `/api/campaigns/:id` | Update campaign | Brand Owner/Admin |
| `DELETE` | `/api/campaigns/:id` | Delete campaign | Brand Owner/Admin |

---

## 👤 User Management Endpoints

### User Operations
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `GET` | `/api/users/profile` | Get user profile | Any authenticated |
| `PUT` | `/api/users/profile` | Update profile | Any authenticated |
| `GET` | `/api/users/:id` | Get specific user | Any authenticated |

---

## 🔐 Authentication Endpoints

### Auth Operations
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `POST` | `/api/auth/login` | User login | Public |
| `POST` | `/api/auth/register` | User registration | Public |
| `POST` | `/api/auth/refresh` | Refresh token | Any authenticated |
| `POST` | `/api/auth/logout` | User logout | Any authenticated |

---

## 💳 Payment Endpoints

### Payment Operations
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `POST` | `/api/payments/create-intent` | Create payment intent | Any authenticated |
| `POST` | `/api/payments/confirm` | Confirm payment | Any authenticated |
| `GET` | `/api/payments/history` | Get payment history | Any authenticated |

---

## 📊 Subscription Endpoints

### Subscription Operations
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `GET` | `/api/subscriptions/plans` | Get subscription plans | Public |
| `POST` | `/api/subscriptions/subscribe` | Subscribe to plan | Any authenticated |
| `GET` | `/api/subscriptions/current` | Get current subscription | Any authenticated |
| `POST` | `/api/subscriptions/cancel` | Cancel subscription | Any authenticated |

---

## 🔄 Request Management Endpoints

### Request Operations
| Method | Endpoint | Purpose | Role Required |
|--------|----------|---------|---------------|
| `POST` | `/api/requests` | Create request | Any authenticated |
| `GET` | `/api/requests` | Get requests | Any authenticated |
| `GET` | `/api/requests/:id` | Get specific request | Any authenticated |
| `PUT` | `/api/requests/:id` | Update request | Request owner |
| `DELETE` | `/api/requests/:id` | Delete request | Request owner |

---

## 📋 Common Response Formats

### Success Response
```typescript
{
  "success": true,
  "data": any,
  "message"?: string
}
```

### Error Response
```typescript
{
  "success": false,
  "message": string,
  "error_code"?: string,
  "details"?: any,
  "suggestion"?: string
}
```

### Paginated Response
```typescript
{
  "success": true,
  "data": {
    "items": any[],
    "pagination": {
      "current_page": number,
      "total_pages": number,
      "total_count": number,
      "has_next": boolean,
      "has_prev": boolean
    }
  }
}
```

---

## 🔌 WebSocket Endpoints

### Real-time Updates
| Endpoint | Purpose | Authentication |
|----------|---------|----------------|
| `ws://your-domain.com` | WebSocket connection | JWT token in query params |

**Connection Parameters:**
```
ws://your-domain.com?token=<JWT_TOKEN>&userId=<USER_ID>
```

---

## 📱 Frontend Usage Examples

### Fetch Conversations
```typescript
const fetchConversations = async (page = 1, limit = 10) => {
  const response = await fetch(`/api/messages/conversations?page=${page}&limit=${limit}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  return response.json();
};
```

### Send Message
```typescript
const sendMessage = async (conversationId: string, content: string) => {
  const response = await fetch(`/api/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  });
  return response.json();
};
```

### Initialize Automated Flow
```typescript
const initializeFlow = async (bidId: string, influencerId: string) => {
  const response = await fetch('/api/bids/automated/initialize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ bid_id: bidId, influencer_id: influencerId })
  });
  return response.json();
};
```

### Handle Button Click
```typescript
const handleButtonClick = async (conversationId: string, buttonType: string, buttonData: any) => {
  const response = await fetch(`/api/messages/conversations/${conversationId}/button-click`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ button_type: buttonType, button_data: buttonData })
  });
  return response.json();
};
```

---

## 🚨 Error Handling

### Common Error Codes
| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

### Error Handling Example
```typescript
const handleApiError = (error: any) => {
  if (error.error_code === 'UNAUTHORIZED') {
    // Redirect to login
    redirectToLogin();
  } else if (error.error_code === 'FORBIDDEN') {
    // Show access denied
    showAccessDenied();
  } else {
    // Show generic error
    showError(error.message);
  }
};
```

---

## 📊 Rate Limits

### Default Limits
- **General API:** 100 requests per minute per user
- **File Uploads:** 10 uploads per minute per user
- **WebSocket:** No limit (connection-based)

### Rate Limit Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

---

## 🔧 Development vs Production

### Development
- **Base URL:** `http://localhost:3000`
- **WebSocket:** `ws://localhost:3000`
- **Debug:** Enabled
- **Logging:** Verbose

### Production
- **Base URL:** `https://api.stoory.com`
- **WebSocket:** `wss://ws.stoory.com`
- **Debug:** Disabled
- **Logging:** Errors only

---

## 📚 Additional Resources

- **Complete API Guide:** `FRONTEND_CHAT_SYSTEM_API_GUIDE.md`
- **Business Flow Guide:** `COMPLETE_BUSINESS_FLOW_GUIDE.md`
- **Implementation Summary:** `IMPLEMENTATION_COMPLETE_SUMMARY.md`

---

## 🎯 Key Points

1. **All endpoints require JWT authentication**
2. **Role-based access control is enforced**
3. **WebSocket for real-time updates**
4. **Comprehensive error handling**
5. **Rate limiting for API protection**
6. **Environment-specific configuration**

The backend is fully ready to support your frontend chat system with automated flows, real-time updates, and comprehensive business logic handling.
