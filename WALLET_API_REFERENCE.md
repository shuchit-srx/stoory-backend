# Wallet API Reference

## Base URL
```
http://localhost:3000/api/payments
```

## Authentication
All endpoints require JWT token in Authorization header:
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Get Wallet Balance
**GET** `/wallet/balance`

Get current wallet balance including available and frozen amounts.

#### Response
```json
{
  "success": true,
  "message": "Wallet balance retrieved successfully",
  "data": {
    "withdrawable_balance": 3200.00,     // Withdrawable amount (rupees)
    "frozen_balance": 500.00,            // Onhold amount (rupees)
    "total_balance": 3700.00,            // Total balance (rupees)
    "withdrawable_balance_paise": 320000, // Withdrawable amount (paise)
    "frozen_balance_paise": 50000,       // Onhold amount (paise)
    "total_balance_paise": 370000,       // Total balance (paise)
    
    // Legacy fields for compatibility
    "available_balance": 3200.00,        // Same as withdrawable_balance
    "balance_paise": 320000              // Same as withdrawable_balance_paise
  }
}
```

#### Error Responses
- `404`: Wallet not found
- `500`: Internal server error

---

### 2. Withdraw Balance
**POST** `/wallet/withdraw`

Withdraw available balance from wallet.

#### Request Body
```json
{
  "amount": 1000.00
}
```

#### Response
```json
{
  "success": true,
  "message": "Withdrawal processed successfully",
  "data": {
    "withdrawal_id": "withdraw_1234567890",
    "amount": 1000.00,
    "new_balance": 2200.00
  }
}
```

#### Error Responses
- `400`: Invalid amount or insufficient balance
- `404`: Wallet not found
- `500`: Internal server error

---

### 3. Get Transaction History
**GET** `/transactions`

Get transaction history for the user.

#### Query Parameters
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `status` (optional): Filter by status (`completed`, `pending`, `failed`)

#### Example
```
GET /transactions?page=1&limit=20&status=completed
```

#### Response
```json
{
  "success": true,
  "transactions": [
    {
      "id": "uuid",
      "amount": 1000.00,
      "amount_paise": 100000,
      "type": "credit",
      "direction": "credit",
      "status": "completed",
      "campaign_id": "uuid",
      "bid_id": "uuid",
      "request_id": "uuid",
      "razorpay_order_id": "order_xxx",
      "razorpay_payment_id": "pay_xxx",
      "notes": "Payment for collaboration",
      "created_at": "2025-01-01T00:00:00Z",
      "campaigns": {
        "id": "uuid",
        "title": "Campaign Title",
        "type": "product"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "pages": 3
  }
}
```

---

## Data Models

### Wallet
```typescript
interface Wallet {
  id: string;
  user_id: string;
  balance: number;              // Available balance (rupees)
  balance_paise: number;        // Available balance (paise)
  frozen_balance_paise: number; // Onhold amount (paise)
  created_at: string;
  updated_at: string;
}
```

### Transaction
```typescript
interface Transaction {
  id: string;
  wallet_id: string;
  user_id: string;
  amount: number;               // Amount in rupees
  amount_paise: number;         // Amount in paise
  type: 'credit' | 'debit' | 'withdrawal';
  direction: 'credit' | 'debit';
  status: 'pending' | 'completed' | 'failed';
  campaign_id?: string;
  bid_id?: string;
  request_id?: string;
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  related_payment_order_id?: string;
  notes?: string;
  created_at: string;
}
```

## Balance Calculation

### Available Balance (Withdrawable)
```
available_balance = balance_paise / 100
```

### Frozen Balance (Onhold)
```
frozen_balance = frozen_balance_paise / 100
```

### Total Balance
```
total_balance = available_balance + frozen_balance
```

## Escrow Flow

### 1. Payment Received
- Money added to `balance_paise`
- Then moved to `frozen_balance_paise` (escrow hold)
- User sees as "On Hold"

### 2. Work Approved
- Money moved from `frozen_balance_paise` to `balance_paise`
- User can withdraw

### 3. Work Rejected
- Money remains in `frozen_balance_paise`
- May be refunded

## Error Codes

| Code | Message | Description |
|------|---------|-------------|
| 400 | Invalid amount | Amount must be positive number |
| 400 | Insufficient available balance | Not enough withdrawable balance |
| 401 | Access token required | Missing Authorization header |
| 403 | Invalid token | Invalid or expired JWT token |
| 404 | Wallet not found | User doesn't have a wallet |
| 500 | Internal server error | Server error occurred |

## Rate Limiting
- No specific rate limits implemented
- Consider implementing client-side throttling for frequent requests

## Caching
- Wallet balance should be cached on frontend
- Refresh after transactions or periodic updates
- Consider 5-10 minute cache TTL
