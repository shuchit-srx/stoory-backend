-- Fix payment flow states - add payment_completed state
-- This ensures proper flow: payment_pending -> payment_completed -> work_in_progress -> real_time

-- Drop existing constraint
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS check_flow_state;

-- Add updated constraint with correct flow states
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
  'payment_completed',      -- Payment completed, ready to start work
  'work_in_progress',       -- Work has started (after payment completion)
  'work_submitted',         -- Influencer submitted work
  'work_approved',          -- Brand owner approved work
  'real_time',              -- Real-time chat enabled (after work completion)
  'chat_closed'             -- Conversation closed
));
