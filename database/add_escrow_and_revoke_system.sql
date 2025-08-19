-- Escrow System and Revoke Management Migration
-- This migration adds support for frozen wallets, work management, and revoke limits

-- 1. Add new request statuses for work management
ALTER TYPE request_status ADD VALUE 'finalized' AFTER 'negotiating';
ALTER TYPE request_status ADD VALUE 'work_submitted' AFTER 'paid';
ALTER TYPE request_status ADD VALUE 'work_approved' AFTER 'work_submitted';

-- 2. Add frozen balance to wallets table
ALTER TABLE wallets ADD COLUMN frozen_balance DECIMAL(10,2) DEFAULT 0.00;

-- 3. Add work management fields to requests table
ALTER TABLE requests ADD COLUMN work_submission_link TEXT;
ALTER TABLE requests ADD COLUMN work_submission_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE requests ADD COLUMN work_approval_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE requests ADD COLUMN revoke_count INTEGER DEFAULT 0;
ALTER TABLE requests ADD COLUMN max_revokes INTEGER DEFAULT 3; -- Set by influencer during application
ALTER TABLE requests ADD COLUMN work_description TEXT; -- Description of submitted work
ALTER TABLE requests ADD COLUMN work_files TEXT[]; -- Array of file URLs (optional storage)

-- 4. Add new transaction types for escrow system
ALTER TYPE transaction_type ADD VALUE 'freeze' AFTER 'debit';
ALTER TYPE transaction_type ADD VALUE 'unfreeze' AFTER 'freeze';

-- 5. Add message types for automated chat system
ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'manual'; -- 'manual', 'automated', 'system'
ALTER TABLE messages ADD COLUMN action_required BOOLEAN DEFAULT FALSE; -- For buttons/actions
ALTER TABLE messages ADD COLUMN action_data JSONB; -- Store action data (buttons, options, etc.)

-- 6. Add conversation status for chat flow management
ALTER TABLE conversations ADD COLUMN chat_status TEXT DEFAULT 'automated'; -- 'automated', 'realtime', 'closed'
ALTER TABLE conversations ADD COLUMN payment_required BOOLEAN DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN payment_completed BOOLEAN DEFAULT FALSE;

-- 7. Create indexes for better performance
CREATE INDEX idx_requests_revoke_count ON requests(revoke_count);
CREATE INDEX idx_requests_max_revokes ON requests(max_revokes);
CREATE INDEX idx_requests_work_submission_date ON requests(work_submission_date);
CREATE INDEX idx_wallets_frozen_balance ON wallets(frozen_balance);
CREATE INDEX idx_messages_message_type ON messages(message_type);
CREATE INDEX idx_conversations_chat_status ON conversations(chat_status);

-- 8. Add comments for documentation
COMMENT ON COLUMN requests.revoke_count IS 'Number of times work has been revised';
COMMENT ON COLUMN requests.max_revokes IS 'Maximum number of revisions allowed (set by influencer)';
COMMENT ON COLUMN requests.work_submission_link IS 'Link to submitted work (external)';
COMMENT ON COLUMN requests.work_files IS 'Array of uploaded file URLs (optional)';
COMMENT ON COLUMN wallets.frozen_balance IS 'Amount frozen in escrow (not withdrawable)';
COMMENT ON COLUMN messages.message_type IS 'Type of message: manual, automated, system';
COMMENT ON COLUMN messages.action_required IS 'Whether message requires user action';
COMMENT ON COLUMN messages.action_data IS 'JSON data for buttons/actions';
COMMENT ON COLUMN conversations.chat_status IS 'Current chat mode: automated, realtime, closed';
COMMENT ON COLUMN conversations.payment_required IS 'Whether payment is required to continue';
COMMENT ON COLUMN conversations.payment_completed IS 'Whether payment has been completed';

-- 9. Create function to check revoke limits
CREATE OR REPLACE FUNCTION check_revoke_limit(request_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    current_revokes INTEGER;
    max_allowed INTEGER;
BEGIN
    SELECT revoke_count, max_revokes 
    INTO current_revokes, max_allowed
    FROM requests 
    WHERE id = request_uuid;
    
    RETURN current_revokes < max_allowed;
END;
$$ LANGUAGE plpgsql;

-- 10. Create function to get wallet balance with frozen amount
CREATE OR REPLACE FUNCTION get_wallet_balance(user_uuid UUID)
RETURNS TABLE(
    available_balance DECIMAL(10,2),
    frozen_balance DECIMAL(10,2),
    total_balance DECIMAL(10,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        w.balance as available_balance,
        w.frozen_balance as frozen_balance,
        (w.balance + w.frozen_balance) as total_balance
    FROM wallets w
    WHERE w.user_id = user_uuid;
END;
$$ LANGUAGE plpgsql;

-- 11. Create trigger to update wallet timestamps
CREATE OR REPLACE FUNCTION update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_wallet_timestamp_trigger
    BEFORE UPDATE ON wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_wallet_timestamp();

-- 12. Add constraints for data integrity
ALTER TABLE requests ADD CONSTRAINT check_revoke_count 
    CHECK (revoke_count >= 0 AND revoke_count <= max_revokes);

ALTER TABLE requests ADD CONSTRAINT check_max_revokes 
    CHECK (max_revokes >= 1 AND max_revokes <= 10);

ALTER TABLE wallets ADD CONSTRAINT check_frozen_balance 
    CHECK (frozen_balance >= 0);

-- 13. Create view for request summary with budget info
CREATE VIEW request_summary AS
SELECT 
    r.id,
    r.influencer_id,
    r.status,
    r.final_agreed_amount,
    r.revoke_count,
    r.max_revokes,
    r.work_submission_date,
    r.work_approval_date,
    CASE 
        WHEN r.campaign_id IS NOT NULL THEN c.budget
        ELSE NULL 
    END as campaign_budget,
    CASE 
        WHEN r.bid_id IS NOT NULL THEN b.min_budget
        ELSE NULL 
    END as bid_min_budget,
    CASE 
        WHEN r.bid_id IS NOT NULL THEN b.max_budget
        ELSE NULL 
    END as bid_max_budget,
    CASE 
        WHEN r.campaign_id IS NOT NULL THEN 'campaign'
        ELSE 'bid'
    END as source_type,
    CASE 
        WHEN r.campaign_id IS NOT NULL THEN c.id
        ELSE b.id
    END as source_id
FROM requests r
LEFT JOIN campaigns c ON r.campaign_id = c.id
LEFT JOIN bids b ON r.bid_id = b.id;
