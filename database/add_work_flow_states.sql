-- Add missing flow states for work submission and completion
-- Run this to update the check_flow_state constraint

-- Drop existing constraint
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_flow_state;

-- Add updated constraint with all flow states
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
  'work_in_progress',        -- After payment, work has started
  'work_submitted',          -- Influencer submitted work
  'work_approved',           -- Brand owner approved work
  'real_time',               -- Real-time chat enabled
  'chat_closed'              -- Conversation closed
));
