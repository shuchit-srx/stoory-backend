-- Migration: Add automation fields to conversations table
-- This enables the automated conversation flow system

-- Add missing automation fields to conversations table
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS flow_state TEXT DEFAULT 'initial',
ADD COLUMN IF NOT EXISTS awaiting_role TEXT,
ADD COLUMN IF NOT EXISTS flow_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS negotiation_round INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS final_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN DEFAULT TRUE;

-- Add constraint for flow_state
ALTER TABLE conversations 
ADD CONSTRAINT check_flow_state 
CHECK (flow_state IN (
    'initial', 'connected', 'influencer_responding', 'negotiating', 
    'brand_owner_confirming', 'influencer_selected', 'both_confirmed', 
    'payment_pending', 'accepted', 'declined', 'completed'
));

-- Add constraint for awaiting_role
ALTER TABLE conversations 
ADD CONSTRAINT check_awaiting_role 
CHECK (awaiting_role IN ('brand_owner', 'influencer', NULL));

-- Add constraint for negotiation_round
ALTER TABLE conversations 
ADD CONSTRAINT check_negotiation_round 
CHECK (negotiation_round >= 0);

-- Add constraint for final_price
ALTER TABLE conversations 
ADD CONSTRAINT check_final_price 
CHECK (final_price IS NULL OR final_price > 0);

-- Update existing conversations to have proper values
UPDATE conversations 
SET 
    flow_state = 'initial',
    awaiting_role = 'brand_owner',
    flow_data = '{}',
    negotiation_round = 0,
    automation_enabled = TRUE
WHERE flow_state IS NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conversations_flow_state ON conversations(flow_state);
CREATE INDEX IF NOT EXISTS idx_conversations_awaiting_role ON conversations(awaiting_role);
CREATE INDEX IF NOT EXISTS idx_conversations_automation_enabled ON conversations(automation_enabled);
CREATE INDEX IF NOT EXISTS idx_conversations_negotiation_round ON conversations(negotiation_round);

-- Create function to update flow state
CREATE OR REPLACE FUNCTION update_conversation_flow_state(
    conversation_uuid UUID,
    new_flow_state TEXT,
    new_awaiting_role TEXT DEFAULT NULL,
    new_flow_data JSONB DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE conversations 
    SET 
        flow_state = new_flow_state,
        awaiting_role = COALESCE(new_awaiting_role, awaiting_role),
        flow_data = COALESCE(new_flow_data, flow_data),
        updated_at = NOW()
    WHERE id = conversation_uuid;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Create function to get conversation context
CREATE OR REPLACE FUNCTION get_conversation_context(conversation_uuid UUID)
RETURNS JSONB AS $$
DECLARE
    context JSONB;
    conv_record RECORD;
BEGIN
    SELECT 
        c.*,
        u1.name as brand_owner_name,
        u1.role as brand_owner_role,
        u2.name as influencer_name,
        u2.role as influencer_role,
        CASE 
            WHEN c.campaign_id IS NOT NULL THEN 
                jsonb_build_object(
                    'type', 'campaign',
                    'id', c.campaign_id,
                    'title', camp.title,
                    'budget', camp.budget,
                    'status', camp.status
                )
            WHEN c.bid_id IS NOT NULL THEN 
                jsonb_build_object(
                    'type', 'bid',
                    'id', c.bid_id,
                    'title', b.title,
                    'min_budget', b.min_budget,
                    'max_budget', b.max_budget,
                    'status', b.status
                )
            ELSE NULL
        END as source_data
    INTO conv_record
    FROM conversations c
    LEFT JOIN users u1 ON c.brand_owner_id = u1.id
    LEFT JOIN users u2 ON c.influencer_id = u2.id
    LEFT JOIN campaigns camp ON c.campaign_id = camp.id
    LEFT JOIN bids b ON c.bid_id = b.id
    WHERE c.id = conversation_uuid;
    
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    
    context := jsonb_build_object(
        'conversation_id', conv_record.id,
        'flow_state', conv_record.flow_state,
        'awaiting_role', conv_record.awaiting_role,
        'chat_status', conv_record.chat_status,
        'automation_enabled', conv_record.automation_enabled,
        'negotiation_round', conv_record.negotiation_round,
        'final_price', conv_record.final_price,
        'brand_owner', jsonb_build_object(
            'id', conv_record.brand_owner_id,
            'name', conv_record.brand_owner_name,
            'role', conv_record.brand_owner_role
        ),
        'influencer', jsonb_build_object(
            'id', conv_record.influencer_id,
            'name', conv_record.influencer_name,
            'role', conv_record.influencer_role
        ),
        'source_data', conv_record.source_data,
        'flow_data', conv_record.flow_data
    );
    
    RETURN context;
END;
$$ LANGUAGE plpgsql;

-- Verify the changes
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'conversations' 
ORDER BY ordinal_position;

-- Show the new constraints
SELECT 
    constraint_name, 
    constraint_type, 
    check_clause
FROM information_schema.check_constraints 
WHERE table_name = 'conversations';

-- Migration completed successfully!
-- The conversations table now has all automation fields needed for:
-- 1. Flow state management (initial, connected, negotiating, etc.)
-- 2. Role-based waiting (who's turn to respond)
-- 3. Flow data storage (JSON for dynamic content)
-- 4. Negotiation tracking (rounds and final price)
-- 5. Automation control (enable/disable automated flows)

