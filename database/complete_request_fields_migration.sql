-- Complete Request Fields Migration
-- This migration adds all necessary fields for request applications

-- 1. Add proposed_amount field to requests table
ALTER TABLE requests ADD COLUMN IF NOT EXISTS proposed_amount DECIMAL(10,2);

-- 2. Add message field to requests table
ALTER TABLE requests ADD COLUMN IF NOT EXISTS message TEXT;

-- 3. Add comments for documentation
COMMENT ON COLUMN requests.proposed_amount IS 'Influencer''s initial proposed amount for bid applications';
COMMENT ON COLUMN requests.message IS 'Influencer''s message when applying to campaign or bid';

-- 4. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_requests_proposed_amount ON requests(proposed_amount);
CREATE INDEX IF NOT EXISTS idx_requests_message ON requests(message);

-- Migration completed successfully!
-- The requests table now supports both campaign and bid applications with messages and proposed amounts.
