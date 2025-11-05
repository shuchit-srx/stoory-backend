-- Add category field to campaigns and bids tables
-- This migration ensures both tables have the category field for consistency

-- Add category to campaigns table
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN campaigns.category IS 'Category of the campaign (e.g., Technology, Fashion, Food, etc.)';

-- Ensure category exists in bids table (should already exist, but adding for safety)
ALTER TABLE bids 
ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN bids.category IS 'Category of the bid (e.g., Technology, Fashion, Food, etc.)';

