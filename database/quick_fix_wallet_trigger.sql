-- Quick fix for wallet trigger issue
-- This script safely updates the wallet creation trigger

-- 1. First, ensure the required columns exist
ALTER TABLE wallets 
ADD COLUMN IF NOT EXISTS balance_paise INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS frozen_balance_paise INTEGER DEFAULT 0;

-- 2. Update existing data
UPDATE wallets 
SET balance_paise = COALESCE(balance * 100, 0) 
WHERE balance_paise = 0 AND balance IS NOT NULL;

UPDATE wallets 
SET frozen_balance_paise = 0 
WHERE frozen_balance_paise IS NULL;

-- 3. Drop the existing trigger and function with CASCADE
DROP TRIGGER IF EXISTS create_wallet_for_user ON users CASCADE;
DROP TRIGGER IF EXISTS trigger_create_wallet ON users CASCADE;
DROP FUNCTION IF EXISTS create_wallet_for_user() CASCADE;

-- 4. Create the updated function
CREATE OR REPLACE FUNCTION create_wallet_for_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO wallets (user_id, balance, balance_paise, frozen_balance_paise)
    VALUES (NEW.id, 0.00, 0, 0);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Recreate the trigger
CREATE TRIGGER create_wallet_for_user
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION create_wallet_for_user();
