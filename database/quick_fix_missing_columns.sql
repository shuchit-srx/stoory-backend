-- Quick fix for missing columns - run this first
-- This adds only the essential missing columns

-- 1. Add flow_data column to conversations
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS flow_data JSONB DEFAULT '{}';

-- 2. Add current_action_data column to conversations
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS current_action_data JSONB DEFAULT '{}';

-- 3. Add conversation_type column to conversations
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS conversation_type VARCHAR(20) DEFAULT 'bid';

-- 4. Add updated_at column to conversations
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 5. Create payment_orders table
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'created',
  razorpay_order_id VARCHAR(255) UNIQUE,
  razorpay_payment_id VARCHAR(255),
  razorpay_signature TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Update flow_state constraint to include payment_pending
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_flow_state;

ALTER TABLE conversations 
ADD CONSTRAINT check_flow_state 
CHECK (flow_state IN (
  'initial',
  'influencer_responding',
  'brand_owner_details',
  'influencer_reviewing',
  'brand_owner_pricing',
  'influencer_price_response',
  'brand_owner_negotiation',
  'influencer_final_response',
  'negotiation_input',
  'payment_pending',
  'work_in_progress',
  'work_submitted',
  'work_approved',
  'real_time',
  'completed',
  'connection_rejected',
  'chat_closed',
  'closed'
));

-- 7. Add basic indexes
CREATE INDEX IF NOT EXISTS idx_conversations_flow_state ON conversations(flow_state);
CREATE INDEX IF NOT EXISTS idx_payment_orders_conversation ON payment_orders(conversation_id);

-- 8. Enable RLS for payment_orders
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

-- 9. Add RLS policy for payment_orders
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
