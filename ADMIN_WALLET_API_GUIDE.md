# Admin Wallet API Guide - Frontend Integration

This guide provides all the endpoints, request/response formats, and example code for integrating the Admin Wallet features into the frontend.

## Authentication

All endpoints require:
- **Authentication**: Bearer token in Authorization header
- **Role**: Admin role only (`req.user.role === 'admin'`)

```javascript
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

---

## Endpoints Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/wallet/transactions` | GET | Get all transactions with filters |
| `/api/admin/wallet/transactions/:id` | GET | Get single transaction details |
| `/api/admin/wallet/users` | GET | Get all users with wallet balances |
| `/api/admin/wallet/users/:userId` | GET | Get specific user's wallet details |
| `/api/admin/wallet/revenue-breakdown` | GET | Get revenue breakdown by type |
| `/api/admin/wallet/statistics` | GET | Get platform-wide statistics |
| `/api/admin/wallet/platform-balance` | GET | Get platform balance summary |
| `/api/admin/wallet/analytics` | GET | Get transaction analytics |

---

## 1. Get All Transactions

**Endpoint:** `GET /api/admin/wallet/transactions`

**Query Parameters:**
- `page` (number, default: 1) - Page number
- `limit` (number, default: 20) - Items per page
- `type` (string, optional) - Filter by transaction type (`credit`, `debit`, `freeze`, `unfreeze`, `withdrawal`, etc.)
- `direction` (string, optional) - Filter by direction (`credit`, `debit`)
- `status` (string, optional) - Filter by status (`pending`, `completed`, `failed`)
- `user_id` (UUID, optional) - Filter by specific user
- `date_from` (ISO string, optional) - Start date filter
- `date_to` (ISO string, optional) - End date filter
- `search` (string, optional) - Search by user name, phone, email, transaction ID, or notes

**Example Request:**
```javascript
const getTransactions = async (filters = {}) => {
  const params = new URLSearchParams({
    page: filters.page || 1,
    limit: filters.limit || 20,
    ...(filters.type && { type: filters.type }),
    ...(filters.direction && { direction: filters.direction }),
    ...(filters.status && { status: filters.status }),
    ...(filters.user_id && { user_id: filters.user_id }),
    ...(filters.date_from && { date_from: filters.date_from }),
    ...(filters.date_to && { date_to: filters.date_to }),
    ...(filters.search && { search: filters.search })
  });

  const response = await fetch(
    `/api/admin/wallet/transactions?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};

// Usage
const transactions = await getTransactions({
  page: 1,
  limit: 20,
  status: 'completed',
  date_from: '2024-01-01T00:00:00Z',
  date_to: '2024-12-31T23:59:59Z',
  search: 'john@example.com'
});
```

**Response Format:**
```json
{
  "success": true,
  "transactions": [
    {
      "id": "uuid",
      "transaction_id": "pay_xxx or uuid",
      "amount": 1000.50,
      "amount_paise": 100050,
      "type": "credit",
      "direction": "credit",
      "status": "completed",
      "stage": "verified",
      "created_at": "2024-01-15T10:30:00Z",
      "user": {
        "id": "user-uuid",
        "name": "John Doe",
        "phone": "+1234567890",
        "email": "john@example.com",
        "role": "influencer"
      },
      "campaign": {
        "id": "campaign-uuid",
        "title": "Summer Campaign",
        "type": "product_review"
      },
      "bid": null,
      "conversation": {
        "id": "conversation-uuid",
        "type": "campaign"
      },
      "razorpay_order_id": "order_xxx",
      "razorpay_payment_id": "pay_xxx",
      "notes": "Payment for campaign collaboration"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  },
  "filters": {
    "type": null,
    "direction": null,
    "status": "completed",
    "user_id": null,
    "date_from": "2024-01-01T00:00:00Z",
    "date_to": "2024-12-31T23:59:59Z",
    "search": "john@example.com"
  }
}
```

---

## 2. Get Transaction Details

**Endpoint:** `GET /api/admin/wallet/transactions/:id`

**Example Request:**
```javascript
const getTransactionDetails = async (transactionId) => {
  const response = await fetch(
    `/api/admin/wallet/transactions/${transactionId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format:**
```json
{
  "success": true,
  "transaction": {
    "id": "uuid",
    "amount": 1000.50,
    "amount_paise": 100050,
    "type": "credit",
    "direction": "credit",
    "status": "completed",
    "stage": "verified",
    "created_at": "2024-01-15T10:30:00Z",
    "user": {
      "id": "user-uuid",
      "name": "John Doe",
      "phone": "+1234567890",
      "email": "john@example.com",
      "role": "influencer"
    },
    "campaign": {
      "id": "campaign-uuid",
      "title": "Summer Campaign",
      "type": "product_review",
      "created_by": "brand-owner-uuid"
    },
    "bid": null,
    "conversation": {
      "id": "conversation-uuid",
      "type": "campaign",
      "brand_owner_id": "brand-owner-uuid",
      "influencer_id": "influencer-uuid"
    },
    "razorpay_order_id": "order_xxx",
    "razorpay_payment_id": "pay_xxx",
    "notes": "Payment for campaign collaboration",
    "request_id": "request-uuid",
    "conversation_id": "conversation-uuid"
  }
}
```

---

## 3. Get All Users with Wallets

**Endpoint:** `GET /api/admin/wallet/users`

**Query Parameters:**
- `page` (number, default: 1) - Page number
- `limit` (number, default: 20) - Items per page
- `role` (string, optional) - Filter by user role (`brand_owner`, `influencer`, `admin`)
- `search` (string, optional) - Search by user name, phone, or email

**Example Request:**
```javascript
const getUsersWithWallets = async (filters = {}) => {
  const params = new URLSearchParams({
    page: filters.page || 1,
    limit: filters.limit || 20,
    ...(filters.role && { role: filters.role }),
    ...(filters.search && { search: filters.search })
  });

  const response = await fetch(
    `/api/admin/wallet/users?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format:**
```json
{
  "success": true,
  "users": [
    {
      "wallet_id": "wallet-uuid",
      "user": {
        "id": "user-uuid",
        "name": "John Doe",
        "phone": "+1234567890",
        "email": "john@example.com",
        "role": "influencer"
      },
      "balance": {
        "available": 50000,
        "available_rupees": 500.00,
        "frozen": 10000,
        "frozen_rupees": 100.00,
        "withdrawn": 20000,
        "withdrawn_rupees": 200.00,
        "total": 80000,
        "total_rupees": 800.00
      },
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "pages": 3
  },
  "filters": {
    "role": null,
    "search": null
  }
}
```

---

## 4. Get User Wallet Details

**Endpoint:** `GET /api/admin/wallet/users/:userId`

**Example Request:**
```javascript
const getUserWalletDetails = async (userId) => {
  const response = await fetch(
    `/api/admin/wallet/users/${userId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format:**
```json
{
  "success": true,
  "user": {
    "id": "user-uuid",
    "name": "John Doe",
    "phone": "+1234567890",
    "email": "john@example.com",
    "role": "influencer"
  },
  "wallet": {
    "id": "wallet-uuid",
    "user_id": "user-uuid",
    "balance": 500.00,
    "balance_paise": 50000,
    "frozen_balance_paise": 10000,
    "withdrawn_balance_paise": 20000,
    "total_balance_paise": 80000,
    "available_balance_rupees": 500.00,
    "frozen_balance_rupees": 100.00,
    "withdrawn_balance_rupees": 200.00,
    "total_balance_rupees": 800.00,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  },
  "balance_summary": {
    "available": 50000,
    "frozen": 10000,
    "withdrawn": 20000,
    "total": 80000,
    "available_rupees": 500.00,
    "frozen_rupees": 100.00,
    "withdrawn_rupees": 200.00,
    "total_rupees": 800.00
  },
  "transaction_summary": {
    "total_credits_paise": 100000,
    "total_debits_paise": 20000,
    "total_withdrawals_paise": 20000,
    "total_escrow_holds_paise": 10000,
    "total_escrow_releases_paise": 5000,
    "net_balance_change_paise": 80000
  },
  "recent_transactions": [
    {
      "id": "transaction-uuid",
      "amount": 1000.50,
      "type": "credit",
      "status": "completed",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

## 5. Get Revenue Breakdown

**Endpoint:** `GET /api/admin/wallet/revenue-breakdown`

**Query Parameters:**
- `days` (number, default: 30) - Number of days to analyze
- `date_from` (ISO string, optional) - Start date (overrides days)
- `date_to` (ISO string, optional) - End date (overrides days)

**Example Request:**
```javascript
const getRevenueBreakdown = async (options = {}) => {
  const params = new URLSearchParams({
    ...(options.days && { days: options.days }),
    ...(options.date_from && { date_from: options.date_from }),
    ...(options.date_to && { date_to: options.date_to })
  });

  const response = await fetch(
    `/api/admin/wallet/revenue-breakdown?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format:**
```json
{
  "success": true,
  "period": "Last 30 days",
  "date_from": "2024-01-01T00:00:00Z",
  "date_to": "2024-01-31T23:59:59Z",
  "revenue": {
    "subscriptions": 185000.00,
    "subscriptions_paise": 18500000,
    "campaign_payments": 96000.00,
    "campaign_payments_paise": 9600000,
    "total_revenue": 281000.00,
    "total_revenue_paise": 28100000
  },
  "expenses": {
    "payouts": 210000.00,
    "payouts_paise": 21000000,
    "refunds": 12000.00,
    "refunds_paise": 1200000,
    "gateway_fees": 8500.00,
    "gateway_fees_paise": 850000,
    "total_expenses": 230500.00,
    "total_expenses_paise": 23050000
  },
  "net_profit": 50500.00,
  "net_profit_paise": 5050000
}
```

---

## 6. Get Platform Statistics

**Endpoint:** `GET /api/admin/wallet/statistics`

**Query Parameters:**
- `days` (number, default: 30) - Number of days to analyze
- `date_from` (ISO string, optional) - Start date (overrides days)
- `date_to` (ISO string, optional) - End date (overrides days)

**Example Request:**
```javascript
const getPlatformStatistics = async (options = {}) => {
  const params = new URLSearchParams({
    ...(options.days && { days: options.days }),
    ...(options.date_from && { date_from: options.date_from }),
    ...(options.date_to && { date_to: options.date_to })
  });

  const response = await fetch(
    `/api/admin/wallet/statistics?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format:**
```json
{
  "success": true,
  "period": "Last 30 days",
  "date_from": "2024-01-01T00:00:00Z",
  "date_to": "2024-01-31T23:59:59Z",
  "platform_balance": {
    "total_balance": 503000.00,
    "total_balance_paise": 50300000,
    "available_balance": 425000.00,
    "available_balance_paise": 42500000,
    "frozen_balance": 78000.00,
    "frozen_balance_paise": 7800000,
    "withdrawn_balance": 0.00,
    "withdrawn_balance_paise": 0
  },
  "transactions": {
    "total_transactions": 1250,
    "pending_transactions": 15,
    "completed_transactions": 1220,
    "failed_transactions": 8,
    "pending_amount": 50000.00,
    "pending_amount_paise": 5000000,
    "failed_amount": 2000.00,
    "failed_amount_paise": 200000
  }
}
```

---

## 7. Get Platform Balance

**Endpoint:** `GET /api/admin/wallet/platform-balance`

**Example Request:**
```javascript
const getPlatformBalance = async () => {
  const response = await fetch(
    `/api/admin/wallet/platform-balance`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format:**
```json
{
  "success": true,
  "platform_available": 425000.00,
  "platform_available_paise": 42500000,
  "platform_pending": 78000.00,
  "platform_pending_paise": 7800000,
  "platform_frozen": 78000.00,
  "platform_frozen_paise": 7800000,
  "total_balance": 503000.00,
  "total_balance_paise": 50300000
}
```

---

## 8. Get Transaction Analytics

**Endpoint:** `GET /api/admin/wallet/analytics`

**Query Parameters:**
- `period` (string, default: 'daily') - Period grouping (`daily`, `weekly`, `monthly`)
- `date_from` (ISO string, optional) - Start date
- `date_to` (ISO string, optional) - End date

**Example Request:**
```javascript
const getTransactionAnalytics = async (options = {}) => {
  const params = new URLSearchParams({
    period: options.period || 'daily',
    ...(options.date_from && { date_from: options.date_from }),
    ...(options.date_to && { date_to: options.date_to })
  });

  const response = await fetch(
    `/api/admin/wallet/analytics?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return await response.json();
};
```

**Response Format:**
```json
{
  "success": true,
  "period": "daily",
  "date_from": "2024-01-01T00:00:00Z",
  "date_to": "2024-01-31T23:59:59Z",
  "trends": [
    {
      "date": "2024-01-01",
      "count": 45,
      "total_amount": 50000.00,
      "total_amount_paise": 5000000,
      "credits": 60000.00,
      "credits_paise": 6000000,
      "debits": 10000.00,
      "debits_paise": 1000000
    }
  ],
  "growth_percentage": 15.5,
  "type_breakdown": [
    {
      "type": "credit",
      "count": 500,
      "total": 500000.00,
      "total_paise": 50000000
    },
    {
      "type": "debit",
      "count": 200,
      "total": 200000.00,
      "total_paise": 20000000
    }
  ],
  "status_breakdown": [
    {
      "status": "completed",
      "count": 680,
      "total": 680000.00,
      "total_paise": 68000000
    },
    {
      "status": "pending",
      "count": 15,
      "total": 15000.00,
      "total_paise": 1500000
    },
    {
      "status": "failed",
      "count": 5,
      "total": 5000.00,
      "total_paise": 500000
    }
  ],
  "summary": {
    "total_transactions": 700,
    "total_amount": 700000.00,
    "total_amount_paise": 70000000,
    "total_credits": 500000.00,
    "total_credits_paise": 50000000,
    "total_debits": 200000.00,
    "total_debits_paise": 20000000
  }
}
```

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error message (in development)"
}
```

**Common Error Codes:**
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (not an admin user)
- `404` - Not found (transaction/user not found)
- `500` - Internal server error

**Example Error Handling:**
```javascript
const handleApiCall = async (apiFunction) => {
  try {
    const response = await apiFunction();
    
    if (!response.success) {
      console.error('API Error:', response.message);
      // Handle error (show toast, etc.)
      return null;
    }
    
    return response;
  } catch (error) {
    console.error('Network Error:', error);
    // Handle network error
    return null;
  }
};

// Usage
const transactions = await handleApiCall(() => 
  getTransactions({ page: 1, limit: 20 })
);
```

---

## React Hook Example

```javascript
import { useState, useEffect } from 'react';

const useAdminWallet = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const token = localStorage.getItem('token'); // or from your auth context

  const apiCall = async (endpoint, options = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams(options.params || {});
      const url = options.id 
        ? `${endpoint}/${options.id}${params.toString() ? `?${params}` : ''}`
        : `${endpoint}${params.toString() ? `?${params}` : ''}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'API request failed');
      }
      
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    getTransactions: (filters) => apiCall('/api/admin/wallet/transactions', { params: filters }),
    getTransactionDetails: (id) => apiCall('/api/admin/wallet/transactions', { id }),
    getUsersWithWallets: (filters) => apiCall('/api/admin/wallet/users', { params: filters }),
    getUserWalletDetails: (userId) => apiCall('/api/admin/wallet/users', { id: userId }),
    getRevenueBreakdown: (options) => apiCall('/api/admin/wallet/revenue-breakdown', { params: options }),
    getPlatformStatistics: (options) => apiCall('/api/admin/wallet/statistics', { params: options }),
    getPlatformBalance: () => apiCall('/api/admin/wallet/platform-balance'),
    getTransactionAnalytics: (options) => apiCall('/api/admin/wallet/analytics', { params: options })
  };
};

// Usage in component
const WalletDashboard = () => {
  const { 
    loading, 
    error, 
    getTransactions, 
    getPlatformBalance,
    getRevenueBreakdown 
  } = useAdminWallet();
  
  const [transactions, setTransactions] = useState([]);
  const [balance, setBalance] = useState(null);
  const [revenue, setRevenue] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [txns, bal, rev] = await Promise.all([
          getTransactions({ page: 1, limit: 10 }),
          getPlatformBalance(),
          getRevenueBreakdown({ days: 30 })
        ]);
        
        setTransactions(txns.transactions);
        setBalance(bal);
        setRevenue(rev);
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    };
    
    loadData();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {/* Your UI components */}
    </div>
  );
};
```

---

## TypeScript Types (Optional)

```typescript
interface Transaction {
  id: string;
  transaction_id: string;
  amount: number;
  amount_paise: number;
  type: string;
  direction: 'credit' | 'debit';
  status: 'pending' | 'completed' | 'failed';
  stage: string;
  created_at: string;
  user: {
    id: string;
    name: string;
    phone: string;
    email: string;
    role: string;
  } | null;
  campaign: {
    id: string;
    title: string;
    type: string;
  } | null;
  bid: {
    id: string;
    title: string;
  } | null;
  conversation: {
    id: string;
    type: string;
  } | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  notes: string | null;
}

interface TransactionsResponse {
  success: boolean;
  transactions: Transaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  filters: {
    type: string | null;
    direction: string | null;
    status: string | null;
    user_id: string | null;
    date_from: string | null;
    date_to: string | null;
    search: string | null;
  };
}

interface RevenueBreakdown {
  success: boolean;
  period: string;
  date_from: string;
  date_to: string;
  revenue: {
    subscriptions: number;
    subscriptions_paise: number;
    campaign_payments: number;
    campaign_payments_paise: number;
    total_revenue: number;
    total_revenue_paise: number;
  };
  expenses: {
    payouts: number;
    payouts_paise: number;
    refunds: number;
    refunds_paise: number;
    gateway_fees: number;
    gateway_fees_paise: number;
    total_expenses: number;
    total_expenses_paise: number;
  };
  net_profit: number;
  net_profit_paise: number;
}
```

---

## Notes

1. **Amounts**: All amounts are provided in both rupees (decimal) and paise (integer) for precision. Use paise for calculations and rupees for display.

2. **Pagination**: Always check `pagination.has_more` or compare `pagination.page < pagination.pages` to determine if more pages exist.

3. **Date Formats**: Use ISO 8601 format for dates (e.g., `2024-01-15T10:30:00Z`).

4. **Search**: The search parameter searches across user name, phone, email, transaction ID, and notes.

5. **Filtering**: Multiple filters can be combined. All filters are optional.

6. **Rate Limiting**: Consider implementing client-side rate limiting or debouncing for frequently called endpoints.

7. **Caching**: Consider caching platform balance and statistics data as they don't change frequently.

---

## Quick Reference

**Base URL**: `/api/admin/wallet`

**Common Headers**:
```javascript
{
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
}
```

**Common Query Params**:
- `page`, `limit` - Pagination
- `date_from`, `date_to` - Date range filtering
- `search` - Text search

**Response Structure**:
```json
{
  "success": true|false,
  "data": {...},
  "message": "Error message (if failed)"
}
```

