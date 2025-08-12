-- Migration: Add new fields to bids table
-- Run this migration to add the new fields to existing bids table

-- Add new columns to bids table
ALTER TABLE bids 
ADD COLUMN IF NOT EXISTS requirements TEXT,
ADD COLUMN IF NOT EXISTS language TEXT,
ADD COLUMN IF NOT EXISTS platform TEXT,
ADD COLUMN IF NOT EXISTS content_type TEXT,
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP WITH TIME ZONE;

-- Add comments for documentation
COMMENT ON COLUMN bids.requirements IS 'Target audience or specific requirements for the bid';
COMMENT ON COLUMN bids.language IS 'Preferred language for content (e.g., English, Hindi)';
COMMENT ON COLUMN bids.platform IS 'Social media platform (e.g., Instagram, YouTube)';
COMMENT ON COLUMN bids.content_type IS 'Type of content required (e.g., Video, Image, Story)';
COMMENT ON COLUMN bids.category IS 'Category of the bid (e.g., Fashion, Tech, Food)';
COMMENT ON COLUMN bids.expiry_date IS 'Date when the bid expires';

-- Create indexes for better performance on new fields
CREATE INDEX IF NOT EXISTS idx_bids_language ON bids(language);
CREATE INDEX IF NOT EXISTS idx_bids_platform ON bids(platform);
CREATE INDEX IF NOT EXISTS idx_bids_category ON bids(category);
CREATE INDEX IF NOT EXISTS idx_bids_expiry_date ON bids(expiry_date);
