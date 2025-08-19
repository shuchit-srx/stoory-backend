-- Add message field to requests table
-- This field stores the influencer's message when applying to campaigns/bids

ALTER TABLE requests ADD COLUMN IF NOT EXISTS message TEXT;

-- Add comment for documentation
COMMENT ON COLUMN requests.message IS 'Influencer''s message when applying to campaign or bid';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_requests_message ON requests(message);
