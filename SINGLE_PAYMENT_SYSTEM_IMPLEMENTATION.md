# Single Payment System Implementation Guide

## Overview
This guide helps you implement the single payment system that replaces the split payment (initial/final) with a single negotiated price that gets frozen and then becomes withdrawable.

## Database Updates

### 1. Run the Migration
Copy and paste the entire content of `database/update_existing_database.sql` into your Supabase SQL Editor and run it.

### 2. Verify Schema Changes
Run these commands in Supabase SQL Editor to verify the changes:

```sql
-- Check if initial_payment and final_payment columns are removed
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'requests' 
AND column_name IN ('initial_payment', 'final_payment');

-- Check if new payment columns are added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'requests' 
AND column_name IN ('payment_status', 'payment_frozen_at', 'payment_withdrawable_at');

-- Check if new transaction types are added
SELECT unnest(enum_range(NULL::transaction_type)) as transaction_types;
```

## Backend Code Updates

### 1. Files Updated
- ✅ `utils/payment.js` - Removed split payment logic
- ✅ `controllers/requestController.js` - Removed initial_payment/final_payment references

### 2. Key Changes Made
- Removed 30%/70% payment calculation
- Removed `initial_payment` and `final_payment` field updates
- Added new payment status fields in API responses
- Simplified payment flow to single payment system

## New Payment Flow

### 1. Negotiation Phase
- Brand and influencer agree on `final_agreed_amount`
- Request status: `negotiating`

### 2. Payment Freeze
- When request status becomes `paid`
- Entire `final_agreed_amount` is frozen in brand's wallet
- Payment status: `frozen`
- Database trigger automatically handles this

### 3. Work Completion
- Influencer completes the work
- Request status: `completed`
- Frozen payment becomes withdrawable for influencer
- Payment status: `withdrawable`
- Database trigger automatically handles this

### 4. Withdrawal
- Influencer can withdraw the amount from their wallet
- Payment status: `completed`

## Database Functions Available

### 1. Manual Payment Control
```sql
-- Freeze payment manually
SELECT freeze_payment_for_request('request-uuid-here');

-- Release payment manually  
SELECT release_payment_to_influencer('request-uuid-here');

-- Mark payment as completed
SELECT mark_payment_completed('request-uuid-here');
```

### 2. Payment Tracking Queries
```sql
-- Get all requests with payment status
SELECT * FROM request_summary WHERE payment_status IS NOT NULL;

-- Get frozen payments
SELECT * FROM requests WHERE payment_status = 'frozen';

-- Get withdrawable payments
SELECT * FROM requests WHERE payment_status = 'withdrawable';

-- Get payment transactions for a request
SELECT * FROM transactions WHERE request_id = 'request-uuid-here';
```

## API Response Changes

### Before (Split Payment)
```json
{
  "final_agreed_amount": 1000,
  "initial_payment": 300,
  "final_payment": 700
}
```

### After (Single Payment)
```json
{
  "final_agreed_amount": 1000,
  "payment_status": "frozen",
  "payment_frozen_at": "2024-01-15T10:30:00Z",
  "payment_withdrawable_at": null
}
```

## Testing the Implementation

### 1. Test Payment Flow
```sql
-- 1. Create a test request with agreed amount
UPDATE requests 
SET final_agreed_amount = 500, status = 'negotiating' 
WHERE id = 'your-test-request-id';

-- 2. Simulate payment (status becomes 'paid')
UPDATE requests 
SET status = 'paid' 
WHERE id = 'your-test-request-id';

-- 3. Check if payment is frozen
SELECT payment_status, payment_frozen_at FROM requests WHERE id = 'your-test-request-id';

-- 4. Simulate completion (status becomes 'completed')
UPDATE requests 
SET status = 'completed' 
WHERE id = 'your-test-request-id';

-- 5. Check if payment is withdrawable
SELECT payment_status, payment_withdrawable_at FROM requests WHERE id = 'your-test-request-id';
```

### 2. Verify Transaction Records
```sql
-- Check transaction history
SELECT 
    t.type,
    t.amount,
    t.status,
    t.created_at,
    w.user_id
FROM transactions t
JOIN wallets w ON t.wallet_id = w.id
WHERE t.request_id = 'your-test-request-id'
ORDER BY t.created_at;
```

## Troubleshooting

### Common Issues

1. **Payment not freezing automatically**
   - Check if the trigger exists: `SELECT * FROM information_schema.triggers WHERE trigger_name = 'update_payment_status_on_request_change';`
   - Verify the function exists: `SELECT * FROM information_schema.routines WHERE routine_name = 'freeze_payment_for_request';`

2. **Insufficient balance error**
   - Ensure brand owner has sufficient balance in their wallet
   - Check wallet balance: `SELECT balance, frozen_balance FROM wallets WHERE user_id = 'brand-owner-id';`

3. **Transaction type errors**
   - Verify new transaction types are added: `SELECT unnest(enum_range(NULL::transaction_type));`

### Rollback Plan
If you need to rollback, you can:
1. Restore the original payment logic in backend code
2. Add back the `initial_payment` and `final_payment` columns
3. Remove the new payment status columns
4. Drop the new functions and triggers

## Benefits of New System

1. **Simplified Payment Flow** - Single payment instead of split payments
2. **Better Escrow Management** - Automatic freezing and release
3. **Improved Tracking** - Clear payment status and timestamps
4. **Reduced Complexity** - No need to manage multiple payment stages
5. **Better User Experience** - Clearer payment status for users

## Next Steps

1. ✅ Run the database migration
2. ✅ Deploy the updated backend code
3. ✅ Test the payment flow
4. ✅ Update frontend to use new payment status fields
5. ✅ Monitor the system for any issues
6. ✅ Update documentation for users

The single payment system is now ready to use! 🎉
