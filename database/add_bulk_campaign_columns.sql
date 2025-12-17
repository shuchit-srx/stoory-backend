-- Migration: Add missing columns to bulk_campaigns table
-- This adds tier_pricing, total_budget, and ensures platform exists

-- Add tier_pricing column if it doesn't exist
ALTER TABLE bulk_campaigns 
ADD COLUMN IF NOT EXISTS tier_pricing JSONB DEFAULT '{}';

-- Add total_budget column if it doesn't exist
ALTER TABLE bulk_campaigns 
ADD COLUMN IF NOT EXISTS total_budget NUMERIC(12, 2) DEFAULT 0;

-- Ensure platform column exists (should already exist, but just in case)
ALTER TABLE bulk_campaigns 
ADD COLUMN IF NOT EXISTS platform TEXT;

-- Add other missing columns that might be needed
ALTER TABLE bulk_campaigns 
ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{}';

ALTER TABLE bulk_campaigns 
ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}';

ALTER TABLE bulk_campaigns 
ADD COLUMN IF NOT EXISTS reference_files JSONB DEFAULT '[]';

ALTER TABLE bulk_campaigns 
ADD COLUMN IF NOT EXISTS deadline DATE;

ALTER TABLE bulk_campaigns 
ADD COLUMN IF NOT EXISTS buffer_days INTEGER DEFAULT 3;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_tier_pricing ON bulk_campaigns USING GIN(tier_pricing);
CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_categories ON bulk_campaigns USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_languages ON bulk_campaigns USING GIN(languages);
CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_reference_files ON bulk_campaigns USING GIN(reference_files);

-- Add comments for documentation
COMMENT ON COLUMN bulk_campaigns.tier_pricing IS 'JSONB object with tier pricing structure: {nano: {...}, micro: {...}, mid: {...}, macro: {...}}';
COMMENT ON COLUMN bulk_campaigns.total_budget IS 'Total calculated budget from all tier pricing';
COMMENT ON COLUMN bulk_campaigns.platform IS 'Social media platform (instagram, youtube, facebook, etc.)';



