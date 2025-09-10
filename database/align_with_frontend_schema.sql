-- Align Database Schema with Frontend Expectations
-- This script updates the database to match the frontend's expected data structures

-- 1. Update conversations table to match frontend expectations
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS conversation_type VARCHAR(20) DEFAULT 'bid' CHECK (conversation_type IN ('bid', 'campaign', 'direct')),
ADD COLUMN IF NOT EXISTS current_action_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS last_state_transition_id UUID,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update flow_data to match frontend structure
ALTER TABLE conversations 
ALTER COLUMN flow_data SET DEFAULT '{}';

-- 2. Create payment_orders table (missing from current schema)
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'processing', 'verified', 'failed', 'refunded')),
  razorpay_order_id VARCHAR(255) UNIQUE,
  razorpay_payment_id VARCHAR(255),
  razorpay_signature TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Update wallets table to use paise (frontend expects paise)
ALTER TABLE wallets 
ADD COLUMN IF NOT EXISTS balance_paise INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS frozen_balance_paise INTEGER DEFAULT 0;

-- Migrate existing balance data to paise (multiply by 100)
UPDATE wallets SET balance_paise = COALESCE(balance * 100, 0) WHERE balance_paise = 0;
UPDATE wallets SET frozen_balance_paise = 0 WHERE frozen_balance_paise IS NULL;

-- 4. Update transactions table to match frontend expectations
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS amount_paise INTEGER,
ADD COLUMN IF NOT EXISTS direction VARCHAR(10) CHECK (direction IN ('debit', 'credit')),
ADD COLUMN IF NOT EXISTS stage VARCHAR(20) CHECK (stage IN ('order_created', 'verified', 'escrow_hold', 'escrow_release', 'refund')),
ADD COLUMN IF NOT EXISTS related_payment_order_id UUID REFERENCES payment_orders(id),
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Migrate existing transaction data
UPDATE transactions SET 
  user_id = (SELECT user_id FROM wallets WHERE wallets.id = transactions.wallet_id),
  amount_paise = COALESCE(amount * 100, 0),
  direction = CASE WHEN type = 'credit' THEN 'credit' ELSE 'debit' END,
  stage = 'verified'
WHERE user_id IS NULL;

-- 5. Create escrow_holds table (missing from current schema)
CREATE TABLE IF NOT EXISTS escrow_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  payment_order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'expired', 'frozen')),
  release_reason VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  released_at TIMESTAMP WITH TIME ZONE
);

-- 6. Create conversation_messages table (separate from messages for better structure)
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'audit')),
  action_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Update flow_state constraint to include all frontend expected states
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_flow_state;

ALTER TABLE conversations 
ADD CONSTRAINT check_flow_state 
CHECK (flow_state IN (
  'influencer_responding', 
  'brand_owner_details', 
  'influencer_reviewing', 
  'brand_owner_pricing', 
  'influencer_price_response', 
  'payment_pending', 
  'work_in_progress', 
  'work_submitted',
  'work_approved',
  'real_time', 
  'completed', 
  'connection_rejected', 
  'closed'
));

-- 8. Update chat_status constraint
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_chat_status;

ALTER TABLE conversations 
ADD CONSTRAINT check_chat_status 
CHECK (chat_status IN ('automated', 'real_time', 'closed'));

-- 9. Update awaiting_role constraint
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_awaiting_role;

ALTER TABLE conversations 
ADD CONSTRAINT check_awaiting_role 
CHECK (awaiting_role IN ('brand_owner', 'influencer') OR awaiting_role IS NULL);

-- 10. Add missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_flow_state ON conversations(flow_state);
CREATE INDEX IF NOT EXISTS idx_conversations_chat_status ON conversations(chat_status);
CREATE INDEX IF NOT EXISTS idx_conversations_conversation_type ON conversations(conversation_type);
CREATE INDEX IF NOT EXISTS idx_payment_orders_conversation ON payment_orders(conversation_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_razorpay ON payment_orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_order ON transactions(related_payment_order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_holds_conversation ON escrow_holds(conversation_id);
CREATE INDEX IF NOT EXISTS idx_escrow_holds_payment_order ON escrow_holds(payment_order_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_created ON conversation_messages(created_at);

-- 11. Add RLS policies for new tables
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payment_orders
CREATE POLICY "Users can view payment orders for their conversations" ON payment_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations 
      WHERE conversations.id = payment_orders.conversation_id 
      AND (conversations.brand_owner_id::text = auth.uid()::text 
           OR conversations.influencer_id::text = auth.uid()::text)
    ) OR 
    auth.jwt() ->> 'role' = 'admin'
  );

-- RLS Policies for escrow_holds
CREATE POLICY "Users can view escrow holds for their conversations" ON escrow_holds
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations 
      WHERE conversations.id = escrow_holds.conversation_id 
      AND (conversations.brand_owner_id::text = auth.uid()::text 
           OR conversations.influencer_id::text = auth.uid()::text)
    ) OR 
    auth.jwt() ->> 'role' = 'admin'
  );

-- RLS Policies for conversation_messages
CREATE POLICY "Users can view messages for their conversations" ON conversation_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations 
      WHERE conversations.id = conversation_messages.conversation_id 
      AND (conversations.brand_owner_id::text = auth.uid()::text 
           OR conversations.influencer_id::text = auth.uid()::text)
    ) OR 
    auth.jwt() ->> 'role' = 'admin'
  );

-- 12. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_conversations_updated_at 
  BEFORE UPDATE ON conversations 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_orders_updated_at 
  BEFORE UPDATE ON payment_orders 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at 
  BEFORE UPDATE ON wallets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
