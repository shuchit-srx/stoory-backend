-- Fix Direct Conversations Constraint Issue
-- The error shows 'idx_direct_connections_unique' constraint violation
-- We need to ensure the constraint allows direct conversations properly

-- First, let's drop any problematic unique constraints
DROP INDEX IF EXISTS idx_direct_connections_unique;

-- The correct constraint structure should be:
-- 1. UNIQUE(campaign_id, brand_owner_id, influencer_id) - for campaign conversations
-- 2. UNIQUE(bid_id, brand_owner_id, influencer_id) - for bid conversations  
-- 3. For direct conversations (campaign_id IS NULL AND bid_id IS NULL), 
--    we should allow ONE conversation per (brand_owner_id, influencer_id) pair

-- Let's ensure we have the right constraints
-- First, drop any existing constraints that might be causing issues
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_brand_owner_id_influencer_id_key;

-- Add a proper unique constraint for direct conversations only
-- This ensures one direct conversation per user pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_conversations_unique 
ON conversations (brand_owner_id, influencer_id) 
WHERE campaign_id IS NULL AND bid_id IS NULL;

-- Ensure campaign conversations are unique per campaign
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_conversations_unique 
ON conversations (campaign_id, brand_owner_id, influencer_id) 
WHERE campaign_id IS NOT NULL;

-- Ensure bid conversations are unique per bid  
CREATE UNIQUE INDEX IF NOT EXISTS idx_bid_conversations_unique 
ON conversations (bid_id, brand_owner_id, influencer_id) 
WHERE bid_id IS NOT NULL;

-- Add a comment explaining the constraint logic
COMMENT ON TABLE conversations IS 'Conversations: Direct (1 per user pair), Campaign (1 per campaign per user pair), Bid (1 per bid per user pair)';
