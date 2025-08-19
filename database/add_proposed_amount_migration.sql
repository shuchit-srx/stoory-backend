-- Add proposed_amount field to requests table
-- This field stores the influencer's initial proposed amount for bids

ALTER TABLE requests ADD COLUMN IF NOT EXISTS proposed_amount DECIMAL(10,2);

-- Add comment for documentation
COMMENT ON COLUMN requests.proposed_amount IS 'Influencer''s initial proposed amount for bid applications';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_requests_proposed_amount ON requests(proposed_amount);
