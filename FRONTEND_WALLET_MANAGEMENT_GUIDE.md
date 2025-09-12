# Frontend Wallet Management Guide

## Overview
This guide explains how to handle wallet balances, onhold amounts, withdrawable amounts, and earnings in the frontend for the Stoory platform.

## Wallet Balance Structure

### API Endpoint
```
GET /api/payments/wallet/balance
Authorization: Bearer <jwt_token>
```

### Response Format
```json
{
  "success": true,
  "message": "Wallet balance retrieved successfully",
  "data": {
    "withdrawable_balance": 3200.00,     // Withdrawable amount (in rupees)
    "frozen_balance": 500.00,            // Onhold amount (in rupees)
    "total_balance": 3700.00,            // Total balance (withdrawable + frozen)
    "withdrawable_balance_paise": 320000, // Withdrawable amount (in paise)
    "frozen_balance_paise": 50000,       // Onhold amount (in paise)
    "total_balance_paise": 370000,       // Total balance (in paise)
    
    // Legacy fields for compatibility
    "available_balance": 3200.00,        // Same as withdrawable_balance
    "balance_paise": 320000              // Same as withdrawable_balance_paise
  }
}
```

## Balance Types Explained

### 1. Withdrawable Balance (Available)
- **Field**: `withdrawable_balance` / `withdrawable_balance_paise` (or legacy `available_balance` / `balance_paise`)
- **Description**: Money that can be withdrawn immediately
- **Source**: Completed payments that are not held in escrow
- **Database**: Stored in `wallets.balance_paise`
- **Usage**: Show this as the primary "Withdrawable" amount

### 2. Frozen Balance (Onhold/Escrow)
- **Field**: `frozen_balance` / `frozen_balance_paise`
- **Description**: Money held in escrow during collaboration
- **Source**: Payments that are being held until work is approved
- **Database**: Stored in `wallets.frozen_balance_paise`
- **Usage**: Show this as "On Hold" or "Pending Release"

### 3. Total Balance
- **Field**: `total_balance`
- **Description**: Sum of available + frozen balance
- **Usage**: Show as total earnings

## Frontend Implementation

### 1. Wallet Overview Component
```javascript
const WalletOverview = () => {
  const [walletData, setWalletData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWalletBalance();
  }, []);

  const fetchWalletBalance = async () => {
    try {
      const response = await fetch('/api/payments/wallet/balance', {
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      if (data.success) {
        setWalletData(data.data);
      }
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!walletData) return <ErrorMessage />;

  return (
    <View style={styles.container}>
      {/* Total Balance Card */}
      <Card style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total Earnings</Text>
        <Text style={styles.totalAmount}>
          ₹{walletData.total_balance.toFixed(2)}
        </Text>
      </Card>

      {/* Balance Breakdown */}
      <View style={styles.breakdown}>
        <BalanceItem
          label="Withdrawable"
          amount={walletData.available_balance}
          color="#4CAF50"
          icon="wallet"
        />
        <BalanceItem
          label="On Hold"
          amount={walletData.frozen_balance}
          color="#FF9800"
          icon="clock"
          description="Pending work approval"
        />
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <Button
          title="Withdraw"
          onPress={handleWithdraw}
          disabled={walletData.available_balance <= 0}
          style={styles.withdrawButton}
        />
        <Button
          title="View Transactions"
          onPress={handleViewTransactions}
          style={styles.transactionButton}
        />
      </View>
    </View>
  );
};
```

### 2. Balance Item Component
```javascript
const BalanceItem = ({ label, amount, color, icon, description }) => (
  <View style={styles.balanceItem}>
    <View style={styles.balanceHeader}>
      <Icon name={icon} size={20} color={color} />
      <Text style={styles.balanceLabel}>{label}</Text>
    </View>
    <Text style={[styles.balanceAmount, { color }]}>
      ₹{amount.toFixed(2)}
    </Text>
    {description && (
      <Text style={styles.balanceDescription}>{description}</Text>
    )}
  </View>
);
```

### 3. Withdrawal Functionality
```javascript
const handleWithdraw = async () => {
  if (walletData.available_balance <= 0) {
    Alert.alert('Error', 'No withdrawable balance available');
    return;
  }

  // Show withdrawal modal
  setShowWithdrawModal(true);
};

const processWithdrawal = async (amount) => {
  try {
    const response = await fetch('/api/payments/wallet/withdraw', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount })
    });

    const data = await response.json();
    if (data.success) {
      Alert.alert('Success', 'Withdrawal request submitted successfully');
      fetchWalletBalance(); // Refresh balance
    } else {
      Alert.alert('Error', data.message);
    }
  } catch (error) {
    Alert.alert('Error', 'Failed to process withdrawal');
  }
};
```

## Transaction History

### API Endpoint
```
GET /api/payments/transactions?page=1&limit=20&status=completed
Authorization: Bearer <jwt_token>
```

### Response Format
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

### Transaction Types
- **credit**: Money added to wallet (payments received)
- **debit**: Money removed from wallet (withdrawals)
- **withdrawal**: Money withdrawn to bank account

### Transaction Status
- **completed**: Successfully processed
- **pending**: Processing
- **failed**: Failed transaction

## Earnings Overview

### Key Metrics to Display
1. **Total Earnings**: Sum of all completed transactions
2. **This Month**: Earnings from current month
3. **Last Month**: Earnings from previous month
4. **Pending**: Amount in escrow (frozen balance)
5. **Withdrawn**: Total amount withdrawn

### Implementation
```javascript
const EarningsOverview = () => {
  const [earnings, setEarnings] = useState({
    total: 0,
    thisMonth: 0,
    lastMonth: 0,
    pending: 0,
    withdrawn: 0
  });

  const calculateEarnings = (transactions) => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    let total = 0;
    let thisMonthEarnings = 0;
    let lastMonthEarnings = 0;
    let withdrawn = 0;

    transactions.forEach(transaction => {
      if (transaction.status === 'completed') {
        if (transaction.type === 'credit') {
          total += transaction.amount;
          
          const transactionDate = new Date(transaction.created_at);
          if (transactionDate >= thisMonth) {
            thisMonthEarnings += transaction.amount;
          } else if (transactionDate >= lastMonth && transactionDate < thisMonth) {
            lastMonthEarnings += transaction.amount;
          }
        } else if (transaction.type === 'withdrawal') {
          withdrawn += transaction.amount;
        }
      }
    });

    return {
      total,
      thisMonth: thisMonthEarnings,
      lastMonth: lastMonthEarnings,
      withdrawn
    };
  };

  // ... rest of component
};
```

## Escrow Flow Explanation

### 1. Payment Received
- Money goes to `available_balance` initially
- Then moved to `frozen_balance` (escrow hold)
- User sees it as "On Hold"

### 2. Work Submission
- Money remains in `frozen_balance`
- Status shows "Pending Approval"

### 3. Work Approved
- Money moves from `frozen_balance` to `available_balance`
- User can now withdraw

### 4. Work Rejected
- Money remains in `frozen_balance`
- May be refunded to brand owner

## Error Handling

### Common Errors
1. **404 - Wallet not found**: User doesn't have a wallet (create one)
2. **400 - Insufficient balance**: Trying to withdraw more than available
3. **403 - Invalid token**: Authentication issue

### Error Handling Implementation
```javascript
const handleApiError = (error, response) => {
  if (response?.status === 404) {
    // Create wallet for user
    createWallet();
  } else if (response?.status === 400) {
    Alert.alert('Insufficient Balance', 'You don\'t have enough withdrawable balance');
  } else if (response?.status === 403) {
    // Redirect to login
    navigation.navigate('Login');
  } else {
    Alert.alert('Error', 'Something went wrong. Please try again.');
  }
};
```

## Best Practices

### 1. Real-time Updates
- Use WebSocket or polling to update wallet balance
- Update balance after successful transactions
- Show loading states during API calls

### 2. User Experience
- Always show both rupee and paise values clearly
- Use appropriate colors (green for available, orange for pending)
- Provide clear explanations for different balance types
- Show transaction history with proper categorization

### 3. Security
- Never store sensitive wallet data in local storage
- Always validate amounts on frontend before API calls
- Use secure token storage
- Implement proper error boundaries

### 4. Performance
- Cache wallet data with appropriate TTL
- Implement pagination for transaction history
- Use optimistic updates for better UX
- Debounce API calls to prevent spam

## Testing Scenarios

### 1. Wallet Creation
- Test with new user (no wallet)
- Test with existing user (has wallet)

### 2. Balance Display
- Test with zero balance
- Test with only available balance
- Test with only frozen balance
- Test with both available and frozen

### 3. Withdrawal
- Test with sufficient balance
- Test with insufficient balance
- Test with zero balance
- Test with invalid amounts

### 4. Transaction History
- Test with no transactions
- Test with many transactions (pagination)
- Test filtering by status
- Test different transaction types

This guide provides a comprehensive framework for implementing wallet management in the frontend while ensuring proper handling of onhold and withdrawable amounts.
