-- Automated Chat System Schema Updates
-- Run this file to add all required fields for automated conversations

-- Add missing columns for automated chat flow to messages table
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'user_input',
ADD COLUMN IF NOT EXISTS action_required BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS action_data JSONB,
ADD COLUMN IF NOT EXISTS is_automated BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS action_completed BOOLEAN DEFAULT FALSE;

-- Add check constraint for message_type
ALTER TABLE messages 
DROP CONSTRAINT IF EXISTS check_message_type;

ALTER TABLE messages 
ADD CONSTRAINT check_message_type 
CHECK (message_type IN (
  'user_input', 
  'automated', 
  'audit', 
  'brand_owner_initial',
  'influencer_connection_response',
  'influencer_project_response',
  'influencer_price_response',
  'brand_owner_negotiation_input',
  'influencer_final_price_response',
  'brand_owner_details_input',
  'brand_owner_pricing_input',
  'brand_owner_payment',
  'brand_owner_negotiation_response'
));

-- Add missing columns for conversations table if not exists
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS flow_state TEXT DEFAULT 'initial',
ADD COLUMN IF NOT EXISTS awaiting_role TEXT,
ADD COLUMN IF NOT EXISTS flow_data JSONB,
ADD COLUMN IF NOT EXISTS chat_status TEXT DEFAULT 'automated';

-- Add check constraint for flow_state
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_flow_state;

ALTER TABLE conversations 
ADD CONSTRAINT check_flow_state 
CHECK (flow_state IN (
  'initial',
  'influencer_responding',
  'influencer_reviewing',
  'influencer_price_response',
  'brand_owner_pricing',
  'negotiation_input',
  'brand_owner_negotiation',
  'payment_pending',
  'payment_completed',
  'real_time',
  'chat_closed'
));

-- Add check constraint for awaiting_role
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_awaiting_role;

ALTER TABLE conversations 
ADD CONSTRAINT check_awaiting_role 
CHECK (awaiting_role IN (
  'brand_owner',
  'influencer',
  NULL
));

-- Add check constraint for chat_status
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_chat_status;

ALTER TABLE conversations 
ADD CONSTRAINT check_chat_status 
CHECK (chat_status IN (
  'automated',
  'real_time',
  'closed'
));

-- Add missing fields to conversations table
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS work_submission JSONB,
ADD COLUMN IF NOT EXISTS submission_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS work_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS conversation_type TEXT DEFAULT 'bid'; -- 'bid' or 'campaign'

-- Add missing fields to messages table  
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS action_required BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS action_data JSONB,
ADD COLUMN IF NOT EXISTS is_automated BOOLEAN DEFAULT false;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_flow_state ON conversations(flow_state);
CREATE INDEX IF NOT EXISTS idx_conversations_awaiting_role ON conversations(awaiting_role);
CREATE INDEX IF NOT EXISTS idx_conversations_conversation_type ON conversations(conversation_type);
CREATE INDEX IF NOT EXISTS idx_messages_action_required ON messages(action_required);
CREATE INDEX IF NOT EXISTS idx_messages_is_automated ON messages(is_automated);

-- Update existing conversations to have proper flow_state
UPDATE conversations 
SET flow_state = 'initial', 
    awaiting_role = 'brand_owner',
    automation_enabled = true,
    conversation_type = CASE 
        WHEN bid_id IS NOT NULL THEN 'bid'
        WHEN campaign_id IS NOT NULL THEN 'campaign'
        ELSE 'direct'
    END
WHERE flow_state IS NULL;

-- Update existing messages to have proper message_type
UPDATE messages 
SET message_type = 'user',
    action_required = false,
    is_automated = false
WHERE message_type IS NULL;

-- Create payment_orders table for automated flow payments
CREATE TABLE IF NOT EXISTS payment_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    influencer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    currency TEXT DEFAULT 'INR',
    razorpay_order_id TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'cancelled')),
    payment_type TEXT DEFAULT 'bid_collaboration',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure payment order is linked to either campaign OR bid, not both
    CONSTRAINT check_payment_order_source CHECK (
        (campaign_id IS NOT NULL AND bid_id IS NULL) OR 
        (campaign_id IS NULL AND bid_id IS NOT NULL)
    )
);

-- Create indexes for payment_orders table
CREATE INDEX IF NOT EXISTS idx_payment_orders_conversation_id ON payment_orders(conversation_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_bid_id ON payment_orders(bid_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_campaign_id ON payment_orders(campaign_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_influencer_id ON payment_orders(influencer_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_brand_owner_id ON payment_orders(brand_owner_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_razorpay_order_id ON payment_orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);

-- Enable RLS for payment_orders table
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payment_orders table
CREATE POLICY "Users can view relevant payment orders" ON payment_orders
    FOR SELECT USING (
        auth.uid()::text = influencer_id::text OR
        auth.uid()::text = brand_owner_id::text OR
        auth.jwt() ->> 'role' = 'admin'
    );

CREATE POLICY "Brand owners can create payment orders" ON payment_orders
    FOR INSERT WITH CHECK (
        auth.uid()::text = brand_owner_id::text AND 
        (auth.jwt() ->> 'role' = 'brand_owner' OR auth.jwt() ->> 'role' = 'admin')
    );

CREATE POLICY "Users can update relevant payment orders" ON payment_orders
    FOR UPDATE USING (
        auth.uid()::text = influencer_id::text OR
        auth.uid()::text = brand_owner_id::text OR
        auth.jwt() ->> 'role' = 'admin'
    );

-- Create trigger for updated_at on payment_orders
CREATE TRIGGER update_payment_orders_updated_at BEFORE UPDATE ON payment_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
