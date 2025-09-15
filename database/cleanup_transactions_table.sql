-- =====================================================
-- TRANSACTIONS TABLE CLEANUP AND OPTIMIZATION
-- =====================================================

-- Step 1: Clean up existing data inconsistencies
-- =====================================================

-- Remove duplicate transactions (same payment_id, different records)
WITH duplicates AS (
  SELECT 
    razorpay_payment_id,
    MIN(created_at) as first_created,
    COUNT(*) as count
  FROM transactions 
  WHERE razorpay_payment_id IS NOT NULL
  GROUP BY razorpay_payment_id
  HAVING COUNT(*) > 1
)
DELETE FROM transactions 
WHERE razorpay_payment_id IN (SELECT razorpay_payment_id FROM duplicates)
  AND created_at > (SELECT first_created FROM duplicates WHERE duplicates.razorpay_payment_id = transactions.razorpay_payment_id);

-- Remove orphaned transactions (no wallet_id or invalid wallet_id)
DELETE FROM transactions 
WHERE wallet_id IS NULL 
   OR wallet_id NOT IN (SELECT id FROM wallets);

-- Remove transactions with invalid user_id
DELETE FROM transactions 
WHERE user_id IS NULL 
   OR user_id NOT IN (SELECT id FROM users);

-- Step 2: Standardize transaction data
-- =====================================================

-- Update missing direction based on type
UPDATE transactions 
SET direction = CASE 
  WHEN type = 'credit' THEN 'credit'
  WHEN type = 'debit' THEN 'debit'
  WHEN type = 'freeze' THEN 'debit'
  WHEN type = 'unfreeze' THEN 'credit'
  ELSE direction
END
WHERE direction IS NULL;

-- Update missing stage based on status and type
UPDATE transactions 
SET stage = CASE 
  WHEN status = 'pending' AND type IN ('credit', 'debit') THEN 'order_created'
  WHEN status = 'completed' AND type IN ('credit', 'debit') THEN 'verified'
  WHEN type = 'freeze' THEN 'escrow_hold'
  WHEN type = 'unfreeze' THEN 'escrow_release'
  ELSE stage
END
WHERE stage IS NULL;

-- Ensure amount_paise is populated from amount
UPDATE transactions 
SET amount_paise = COALESCE(amount_paise, ROUND(amount * 100))
WHERE amount_paise IS NULL AND amount IS NOT NULL;

-- Step 3: Add missing foreign key relationships
-- =====================================================

-- Update conversation_id from related tables
UPDATE transactions 
SET conversation_id = (
  SELECT conversation_id 
  FROM payment_orders 
  WHERE payment_orders.id = transactions.related_payment_order_id
)
WHERE conversation_id IS NULL 
  AND related_payment_order_id IS NOT NULL;

-- Update sender_id and receiver_id from conversation data
UPDATE transactions 
SET 
  sender_id = (
    SELECT brand_owner_id 
    FROM conversations 
    WHERE conversations.id = transactions.conversation_id
  ),
  receiver_id = (
    SELECT influencer_id 
    FROM conversations 
    WHERE conversations.id = transactions.conversation_id
  )
WHERE sender_id IS NULL 
  AND receiver_id IS NULL 
  AND conversation_id IS NOT NULL;

-- Step 4: Clean up redundant columns and constraints
-- =====================================================

-- Remove redundant payment_amount column (use amount instead)
-- First, ensure amount is populated from payment_amount where needed
UPDATE transactions 
SET amount = COALESCE(amount, payment_amount)
WHERE amount IS NULL AND payment_amount IS NOT NULL;

-- Drop the redundant column (commented out for safety - uncomment if needed)
-- ALTER TABLE transactions DROP COLUMN IF EXISTS payment_amount;

-- Step 5: Add missing constraints and indexes
-- =====================================================

-- Add NOT NULL constraints where appropriate
ALTER TABLE transactions 
ALTER COLUMN wallet_id SET NOT NULL,
ALTER COLUMN amount SET NOT NULL,
ALTER COLUMN type SET NOT NULL,
ALTER COLUMN direction SET NOT NULL,
ALTER COLUMN user_id SET NOT NULL;

-- Add check constraints for data integrity
ALTER TABLE transactions 
ADD CONSTRAINT transactions_amount_positive CHECK (amount > 0),
ADD CONSTRAINT transactions_amount_paise_positive CHECK (amount_paise > 0),
ADD CONSTRAINT transactions_amount_consistency CHECK (
  ABS(amount * 100 - amount_paise) < 1
);

-- Add constraint to ensure sender and receiver are different
ALTER TABLE transactions 
ADD CONSTRAINT transactions_sender_receiver_different CHECK (sender_id != receiver_id);

-- Step 6: Create optimized indexes
-- =====================================================

-- Drop existing indexes that might be redundant
DROP INDEX IF EXISTS idx_transactions_campaign_id;
DROP INDEX IF EXISTS idx_transactions_bid_id;
DROP INDEX IF EXISTS idx_transactions_request_id;

-- Create comprehensive indexes for better performance
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_user ON transactions(wallet_id, user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type_status ON transactions(type, status);
CREATE INDEX IF NOT EXISTS idx_transactions_stage ON transactions(stage);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_conversation ON transactions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_flow ON transactions(razorpay_payment_id, razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_sender_receiver ON transactions(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_transactions_escrow_hold ON transactions(escrow_hold_id);

-- Step 7: Add data validation views
-- =====================================================

-- Create view for transaction summary by user
CREATE OR REPLACE VIEW user_transaction_summary AS
SELECT 
  u.id as user_id,
  u.name as user_name,
  u.phone,
  COUNT(t.id) as total_transactions,
  SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END) as total_credits,
  SUM(CASE WHEN t.type = 'debit' THEN t.amount ELSE 0 END) as total_debits,
  SUM(CASE WHEN t.type = 'freeze' THEN t.amount ELSE 0 END) as total_frozen,
  SUM(CASE WHEN t.type = 'unfreeze' THEN t.amount ELSE 0 END) as total_unfrozen,
  MAX(t.created_at) as last_transaction_date
FROM users u
LEFT JOIN transactions t ON u.id = t.user_id
GROUP BY u.id, u.name, u.phone;

-- Create view for escrow transaction tracking
CREATE OR REPLACE VIEW escrow_transaction_tracking AS
SELECT 
  eh.id as escrow_hold_id,
  eh.conversation_id,
  eh.amount_paise,
  eh.status as escrow_status,
  eh.created_at as escrow_created,
  eh.released_at as escrow_released,
  t_freeze.id as freeze_transaction_id,
  t_freeze.created_at as freeze_date,
  t_unfreeze.id as unfreeze_transaction_id,
  t_unfreeze.created_at as unfreeze_date,
  CASE 
    WHEN t_unfreeze.id IS NOT NULL THEN 'released'
    WHEN t_freeze.id IS NOT NULL THEN 'held'
    ELSE 'pending'
  END as transaction_status
FROM escrow_holds eh
LEFT JOIN transactions t_freeze ON eh.id = t_freeze.escrow_hold_id AND t_freeze.type = 'freeze'
LEFT JOIN transactions t_unfreeze ON eh.id = t_unfreeze.escrow_hold_id AND t_unfreeze.type = 'unfreeze';

-- Step 8: Add data integrity checks
-- =====================================================

-- Function to validate transaction consistency
CREATE OR REPLACE FUNCTION validate_transaction_consistency()
RETURNS TABLE (
  issue_type TEXT,
  issue_description TEXT,
  transaction_id UUID,
  severity TEXT
) AS $$
BEGIN
  -- Check for transactions with missing required fields
  RETURN QUERY
  SELECT 
    'missing_required_field'::TEXT,
    'Transaction missing ' || COALESCE(
      CASE WHEN wallet_id IS NULL THEN 'wallet_id' END,
      CASE WHEN user_id IS NULL THEN 'user_id' END,
      CASE WHEN amount IS NULL THEN 'amount' END,
      CASE WHEN type IS NULL THEN 'type' END
    )::TEXT,
    id,
    'error'::TEXT
  FROM transactions 
  WHERE wallet_id IS NULL OR user_id IS NULL OR amount IS NULL OR type IS NULL;
  
  -- Check for amount inconsistencies
  RETURN QUERY
  SELECT 
    'amount_inconsistency'::TEXT,
    'Amount and amount_paise do not match: ' || amount || ' vs ' || amount_paise::TEXT,
    id,
    'warning'::TEXT
  FROM transactions 
  WHERE ABS(amount * 100 - amount_paise) >= 1;
  
  -- Check for orphaned transactions
  RETURN QUERY
  SELECT 
    'orphaned_transaction'::TEXT,
    'Transaction references non-existent wallet',
    t.id,
    'error'::TEXT
  FROM transactions t
  LEFT JOIN wallets w ON t.wallet_id = w.id
  WHERE w.id IS NULL;
  
  -- Check for duplicate payment IDs
  RETURN QUERY
  SELECT 
    'duplicate_payment'::TEXT,
    'Multiple transactions with same payment ID: ' || razorpay_payment_id,
    id,
    'warning'::TEXT
  FROM (
    SELECT id, razorpay_payment_id, ROW_NUMBER() OVER (PARTITION BY razorpay_payment_id ORDER BY created_at) as rn
    FROM transactions 
    WHERE razorpay_payment_id IS NOT NULL
  ) t
  WHERE t.rn > 1;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Create cleanup maintenance function
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_transactions_table()
RETURNS TEXT AS $$
DECLARE
  deleted_count INTEGER := 0;
  updated_count INTEGER := 0;
BEGIN
  -- Remove orphaned transactions
  DELETE FROM transactions 
  WHERE wallet_id NOT IN (SELECT id FROM wallets);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Update missing data
  UPDATE transactions 
  SET direction = CASE 
    WHEN type = 'credit' THEN 'credit'
    WHEN type = 'debit' THEN 'debit'
    WHEN type = 'freeze' THEN 'debit'
    WHEN type = 'unfreeze' THEN 'credit'
    ELSE direction
  END
  WHERE direction IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  RETURN 'Cleanup completed: ' || deleted_count || ' transactions deleted, ' || updated_count || ' transactions updated';
END;
$$ LANGUAGE plpgsql;

-- Step 10: Grant permissions
-- =====================================================

-- Grant necessary permissions for the views and functions
GRANT SELECT ON user_transaction_summary TO authenticated;
GRANT SELECT ON escrow_transaction_tracking TO authenticated;
GRANT EXECUTE ON FUNCTION validate_transaction_consistency() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_transactions_table() TO authenticated;

-- Step 11: Final validation
-- =====================================================

-- Run validation to check for any remaining issues
SELECT * FROM validate_transaction_consistency();

-- Show summary statistics
SELECT 
  'Total Transactions' as metric,
  COUNT(*)::TEXT as value
FROM transactions
UNION ALL
SELECT 
  'Credit Transactions',
  COUNT(*)::TEXT
FROM transactions WHERE type = 'credit'
UNION ALL
SELECT 
  'Debit Transactions',
  COUNT(*)::TEXT
FROM transactions WHERE type = 'debit'
UNION ALL
SELECT 
  'Escrow Transactions',
  COUNT(*)::TEXT
FROM transactions WHERE type IN ('freeze', 'unfreeze')
UNION ALL
SELECT 
  'Completed Transactions',
  COUNT(*)::TEXT
FROM transactions WHERE status = 'completed'
UNION ALL
SELECT 
  'Pending Transactions',
  COUNT(*)::TEXT
FROM transactions WHERE status = 'pending';

COMMIT;
