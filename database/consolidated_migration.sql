-- =====================================================
-- CONSOLIDATED DATABASE MIGRATION
-- Single Payment System Implementation
-- =====================================================

-- 1. Remove initial_payment and final_payment columns from requests table
ALTER TABLE requests DROP COLUMN IF EXISTS initial_payment;
ALTER TABLE requests DROP COLUMN IF EXISTS final_payment;

-- 2. Add constraint to ensure final_agreed_amount is positive when set (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'check_final_agreed_amount' 
        AND table_name = 'requests'
    ) THEN
        ALTER TABLE requests ADD CONSTRAINT check_final_agreed_amount 
            CHECK (final_agreed_amount IS NULL OR final_agreed_amount > 0);
    END IF;
END $$;

-- 3. Add payment status tracking to requests table
ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending' 
    CHECK (payment_status IN ('pending', 'frozen', 'withdrawable', 'completed'));

-- 4. Add payment freeze date and withdrawal date tracking
ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_frozen_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_withdrawable_at TIMESTAMP WITH TIME ZONE;

-- 5. Remove payment_stage column from transactions table
ALTER TABLE transactions DROP COLUMN IF EXISTS payment_stage;

-- 6. Add new transaction types for single payment system
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'freeze_payment' AFTER 'freeze';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'release_payment' AFTER 'unfreeze';

-- 7. Add payment amount to transactions table for better tracking
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(10,2);

-- 8. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_requests_payment_status ON requests(payment_status);
CREATE INDEX IF NOT EXISTS idx_requests_payment_frozen_at ON requests(payment_frozen_at);
CREATE INDEX IF NOT EXISTS idx_requests_payment_withdrawable_at ON requests(payment_withdrawable_at);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_amount ON transactions(payment_amount);

-- 9. Add comments for documentation
COMMENT ON COLUMN requests.final_agreed_amount IS 'Single negotiated price between brand and influencer';
COMMENT ON COLUMN requests.payment_status IS 'Current payment status: pending, frozen, withdrawable, completed';
COMMENT ON COLUMN requests.payment_frozen_at IS 'Timestamp when payment was frozen in escrow';
COMMENT ON COLUMN requests.payment_withdrawable_at IS 'Timestamp when payment became withdrawable';
COMMENT ON COLUMN transactions.payment_amount IS 'Amount of the payment transaction';

-- 10. Create function to freeze payment for a request
CREATE OR REPLACE FUNCTION freeze_payment_for_request(request_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    request_record RECORD;
    brand_wallet_id UUID;
    influencer_wallet_id UUID;
    agreed_amount DECIMAL(10,2);
BEGIN
    -- Get request details
    SELECT r.*, 
           CASE 
               WHEN r.campaign_id IS NOT NULL THEN c.created_by
               ELSE b.created_by
           END as brand_owner_id
    INTO request_record
    FROM requests r
    LEFT JOIN campaigns c ON r.campaign_id = c.id
    LEFT JOIN bids b ON r.bid_id = b.id
    WHERE r.id = request_uuid;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found';
    END IF;
    
    IF request_record.final_agreed_amount IS NULL THEN
        RAISE EXCEPTION 'No agreed amount set for request';
    END IF;
    
    IF request_record.payment_status != 'pending' THEN
        RAISE EXCEPTION 'Payment already processed for this request';
    END IF;
    
    agreed_amount := request_record.final_agreed_amount;
    
    -- Get brand owner's wallet
    SELECT id INTO brand_wallet_id 
    FROM wallets 
    WHERE user_id = request_record.brand_owner_id;
    
    -- Get influencer's wallet
    SELECT id INTO influencer_wallet_id 
    FROM wallets 
    WHERE user_id = request_record.influencer_id;
    
    -- Check if brand owner has sufficient balance
    IF (SELECT balance FROM wallets WHERE id = brand_wallet_id) < agreed_amount THEN
        RAISE EXCEPTION 'Insufficient balance in brand owner wallet';
    END IF;
    
    -- Begin transaction
    BEGIN
        -- Deduct from brand owner's wallet
        UPDATE wallets 
        SET balance = balance - agreed_amount,
            frozen_balance = frozen_balance + agreed_amount
        WHERE id = brand_wallet_id;
        
        -- Create transaction record for brand owner
        INSERT INTO transactions (
            wallet_id, 
            amount, 
            type, 
            status, 
            campaign_id, 
            bid_id, 
            request_id,
            payment_amount
        ) VALUES (
            brand_wallet_id,
            agreed_amount,
            'freeze_payment',
            'completed',
            request_record.campaign_id,
            request_record.bid_id,
            request_uuid,
            agreed_amount
        );
        
        -- Update request status
        UPDATE requests 
        SET payment_status = 'frozen',
            payment_frozen_at = NOW()
        WHERE id = request_uuid;
        
        RETURN TRUE;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Failed to freeze payment: %', SQLERRM;
    END;
END;
$$ LANGUAGE plpgsql;

-- 11. Create function to release payment to influencer
CREATE OR REPLACE FUNCTION release_payment_to_influencer(request_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    request_record RECORD;
    brand_wallet_id UUID;
    influencer_wallet_id UUID;
    agreed_amount DECIMAL(10,2);
BEGIN
    -- Get request details
    SELECT r.*, 
           CASE 
               WHEN r.campaign_id IS NOT NULL THEN c.created_by
               ELSE b.created_by
           END as brand_owner_id
    INTO request_record
    FROM requests r
    LEFT JOIN campaigns c ON r.campaign_id = c.id
    LEFT JOIN bids b ON r.bid_id = b.id
    WHERE r.id = request_uuid;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found';
    END IF;
    
    IF request_record.payment_status != 'frozen' THEN
        RAISE EXCEPTION 'Payment is not frozen for this request';
    END IF;
    
    agreed_amount := request_record.final_agreed_amount;
    
    -- Get brand owner's wallet
    SELECT id INTO brand_wallet_id 
    FROM wallets 
    WHERE user_id = request_record.brand_owner_id;
    
    -- Get influencer's wallet
    SELECT id INTO influencer_wallet_id 
    FROM wallets 
    WHERE user_id = request_record.influencer_id;
    
    -- Begin transaction
    BEGIN
        -- Remove from brand owner's frozen balance
        UPDATE wallets 
        SET frozen_balance = frozen_balance - agreed_amount
        WHERE id = brand_wallet_id;
        
        -- Add to influencer's available balance
        UPDATE wallets 
        SET balance = balance + agreed_amount
        WHERE id = influencer_wallet_id;
        
        -- Create transaction record for influencer
        INSERT INTO transactions (
            wallet_id, 
            amount, 
            type, 
            status, 
            campaign_id, 
            bid_id, 
            request_id,
            payment_amount
        ) VALUES (
            influencer_wallet_id,
            agreed_amount,
            'release_payment',
            'completed',
            request_record.campaign_id,
            request_record.bid_id,
            request_uuid,
            agreed_amount
        );
        
        -- Update request status
        UPDATE requests 
        SET payment_status = 'withdrawable',
            payment_withdrawable_at = NOW()
        WHERE id = request_uuid;
        
        RETURN TRUE;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Failed to release payment: %', SQLERRM;
    END;
END;
$$ LANGUAGE plpgsql;

-- 12. Create function to mark payment as completed
CREATE OR REPLACE FUNCTION mark_payment_completed(request_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE requests 
    SET payment_status = 'completed'
    WHERE id = request_uuid 
    AND payment_status = 'withdrawable';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found or payment not withdrawable';
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 13. Update the request_summary view to reflect new payment structure
DROP VIEW IF EXISTS request_summary;

CREATE VIEW request_summary AS
SELECT 
    r.id,
    r.influencer_id,
    r.status,
    r.final_agreed_amount,
    r.payment_status,
    r.payment_frozen_at,
    r.payment_withdrawable_at,
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

-- 14. Create trigger to automatically update payment status when request status changes
CREATE OR REPLACE FUNCTION update_payment_status_on_request_change()
RETURNS TRIGGER AS $$
BEGIN
    -- When request status becomes 'paid', freeze the payment
    IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
        IF NEW.final_agreed_amount IS NOT NULL THEN
            PERFORM freeze_payment_for_request(NEW.id);
        END IF;
    END IF;
    
    -- When request status becomes 'completed', release the payment
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        IF NEW.payment_status = 'frozen' THEN
            PERFORM release_payment_to_influencer(NEW.id);
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_payment_status_on_request_change ON requests;

CREATE TRIGGER update_payment_status_on_request_change
    AFTER UPDATE ON requests
    FOR EACH ROW
    EXECUTE FUNCTION update_payment_status_on_request_change();

-- Migration completed successfully!
-- The payment system now uses a single negotiated price (final_agreed_amount)
-- with frozen payments that become withdrawable upon completion.
-- Initial and final payment fields have been removed.
