-- Plans table (if not exists)
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL,
    currency TEXT DEFAULT 'INR',
    duration_months INTEGER NOT NULL DEFAULT 1,
    features TEXT[],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed basic plans if table is empty
INSERT INTO plans (name, description, price, duration_months, features)
SELECT 'Basic', 'Basic access', 0.00, 1, ARRAY['Limited discovery']
WHERE NOT EXISTS (SELECT 1 FROM plans);

INSERT INTO plans (name, description, price, duration_months, features)
SELECT 'Premium Monthly', 'Premium access monthly', 999.00, 1, ARRAY['Full discovery','Priority support']
WHERE NOT EXISTS (
    SELECT 1 FROM plans p WHERE p.name = 'Premium Monthly'
);

INSERT INTO plans (name, description, price, duration_months, features)
SELECT 'Premium Quarterly', 'Premium access 3 months', 2499.00, 3, ARRAY['Full discovery','Priority support','Discounted']
WHERE NOT EXISTS (
    SELECT 1 FROM plans p WHERE p.name = 'Premium Quarterly'
);
-- User reporting and blocking feature
DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('open', 'in_review', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reasons master (admin-manageable)
CREATE TABLE IF NOT EXISTS report_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reports from users
CREATE TABLE IF NOT EXISTS user_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporter_role user_role NOT NULL,
  reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  reason_id UUID REFERENCES report_reasons(id) ON DELETE SET NULL,
  reason_text TEXT,
  status report_status DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_user_reports_reported_user_id ON user_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_reporter_id ON user_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status);

-- Add block fields to users if not present
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN blocked_until TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN blocked_reason TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Track admin block/unblock actions
CREATE TABLE IF NOT EXISTS user_block_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('block','unblock')),
  reason TEXT,
  blocked_until TIMESTAMPTZ,
  performed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Simple RLS (admin-only) for management tables (optional depending on usage of PostgREST)
ALTER TABLE report_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_block_events ENABLE ROW LEVEL SECURITY;

-- Policies: allow admins full access; reporters can see their own; reported users can see reports against them (counting in UI)
DO $$ BEGIN
  CREATE POLICY report_reasons_admin_all ON report_reasons FOR ALL USING (auth.jwt() ->> 'role' = 'admin') WITH CHECK (auth.jwt() ->> 'role' = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_reports_admin_all ON user_reports FOR ALL USING (auth.jwt() ->> 'role' = 'admin') WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_reports_read_own ON user_reports FOR SELECT USING (auth.uid()::text = reporter_id::text OR auth.uid()::text = reported_user_id::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_reports_insert_self ON user_reports FOR INSERT WITH CHECK (auth.uid()::text = reporter_id::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_block_events_admin_all ON user_block_events FOR ALL USING (auth.jwt() ->> 'role' = 'admin') WITH CHECK (auth.jwt() ->> 'role' = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
