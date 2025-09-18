-- Fix Direct Conversations: Remove unique constraint that prevents multiple direct conversations
-- between the same users

-- Drop any existing unique constraint on brand_owner_id, influencer_id for direct conversations
-- This allows multiple direct conversations between the same users

-- First, let's check if there's a unique constraint we need to drop
-- The error mentioned 'idx_direct_connections_unique' so let's drop it if it exists

-- Drop the problematic unique constraint
DROP INDEX IF EXISTS idx_direct_connections_unique;

-- Also drop any unique constraint on conversations table that might be causing issues
-- We only want unique constraints for campaign and bid conversations, not direct ones

-- Check if there's a unique constraint on (brand_owner_id, influencer_id) without campaign_id/bid_id
-- If such a constraint exists, we need to drop it

-- The original schema only has:
-- UNIQUE(campaign_id, brand_owner_id, influencer_id)
-- UNIQUE(bid_id, brand_owner_id, influencer_id)
-- 
-- But there might be an additional constraint that was added later

-- Let's ensure the table structure is correct for direct conversations
-- Direct conversations should NOT have unique constraints on (brand_owner_id, influencer_id)
-- because users should be able to have multiple direct conversations

-- Add a comment to clarify the constraint logic
COMMENT ON TABLE conversations IS 'Conversations table with different types: direct (multiple allowed), campaign (unique per campaign), bid (unique per bid)';
