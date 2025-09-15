-- Add missing columns to transactions table for better tracking
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS receiver_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS escrow_hold_id UUID REFERENCES escrow_holds(id) ON DELETE SET NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender_id);
CREATE INDEX IF NOT EXISTS idx_transactions_receiver ON transactions(receiver_id);
CREATE INDEX IF NOT EXISTS idx_transactions_escrow ON transactions(escrow_hold_id);

-- Update existing transactions to have proper sender/receiver info where possible
UPDATE transactions 
SET sender_id = (
    SELECT brand_owner_id 
    FROM conversations 
    WHERE conversations.id = (
        SELECT conversation_id 
        FROM payment_orders 
        WHERE payment_orders.id = transactions.related_payment_order_id
    )
),
receiver_id = (
    SELECT influencer_id 
    FROM conversations 
    WHERE conversations.id = (
        SELECT conversation_id 
        FROM payment_orders 
        WHERE payment_orders.id = transactions.related_payment_order_id
    )
)
WHERE related_payment_order_id IS NOT NULL 
AND sender_id IS NULL 
AND receiver_id IS NULL;
