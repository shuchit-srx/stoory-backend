-- Simple Coupon System
-- Just the essential tables and functions

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create coupon types
DO $$ BEGIN
    CREATE TYPE coupon_type AS ENUM ('percentage', 'fixed_amount', 'free_trial');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Coupons table
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type coupon_type NOT NULL,
    value DECIMAL(10,2) NOT NULL,
    min_order_amount DECIMAL(10,2) DEFAULT 0,
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    usage_limit_per_user INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Coupon usage table
CREATE TABLE IF NOT EXISTS coupon_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    original_amount DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL,
    final_amount DECIMAL(10,2) NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_user_id ON coupon_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_coupon_id ON coupon_usage(coupon_id);

-- Add constraints
ALTER TABLE coupons ADD CONSTRAINT check_coupon_value_positive CHECK (value >= 0);
ALTER TABLE coupons ADD CONSTRAINT check_coupon_min_order_positive CHECK (min_order_amount >= 0);
ALTER TABLE coupons ADD CONSTRAINT check_coupon_usage_limit_positive CHECK (usage_limit IS NULL OR usage_limit > 0);
ALTER TABLE coupons ADD CONSTRAINT check_coupon_usage_count_non_negative CHECK (usage_count >= 0);
ALTER TABLE coupons ADD CONSTRAINT check_coupon_usage_limit_per_user_positive CHECK (usage_limit_per_user > 0);
ALTER TABLE coupons ADD CONSTRAINT check_coupon_valid_dates CHECK (valid_until > valid_from);

-- Simple function to validate coupon
CREATE OR REPLACE FUNCTION validate_coupon(
    p_coupon_code VARCHAR(50),
    p_user_id UUID,
    p_order_amount DECIMAL(10,2)
) RETURNS JSONB AS $$
DECLARE
    coupon_record coupons%ROWTYPE;
    usage_count INTEGER;
    discount_amount DECIMAL(10,2) := 0;
    final_amount DECIMAL(10,2) := p_order_amount;
BEGIN
    -- Get coupon
    SELECT * INTO coupon_record 
    FROM coupons 
    WHERE code = p_coupon_code AND is_active = true;
    
    -- Check if coupon exists
    IF NOT FOUND THEN
        RETURN jsonb_build_object('is_valid', false, 'valid', false, 'error', 'Invalid coupon code');
    END IF;
    
    -- Check validity period
    IF NOW() < coupon_record.valid_from OR NOW() > coupon_record.valid_until THEN
        RETURN jsonb_build_object('is_valid', false, 'valid', false, 'error', 'Coupon has expired');
    END IF;
    
    -- Check usage limit
    IF coupon_record.usage_limit IS NOT NULL AND coupon_record.usage_count >= coupon_record.usage_limit THEN
        RETURN jsonb_build_object('is_valid', false, 'valid', false, 'error', 'Coupon usage limit exceeded');
    END IF;
    
    -- Check minimum order amount
    IF p_order_amount < coupon_record.min_order_amount THEN
        RETURN jsonb_build_object('is_valid', false, 'valid', false, 'error', 'Minimum order amount not met');
    END IF;
    
    -- Check user usage limit
    SELECT COUNT(*) INTO usage_count
    FROM coupon_usage 
    WHERE coupon_id = coupon_record.id AND user_id = p_user_id;
    
    IF usage_count >= coupon_record.usage_limit_per_user THEN
        RETURN jsonb_build_object('is_valid', false, 'valid', false, 'error', 'You have already used this coupon');
    END IF;
    
    -- Calculate discount
    CASE
        WHEN coupon_record.type = 'percentage' THEN
            discount_amount := (p_order_amount * coupon_record.value / 100);
        WHEN coupon_record.type = 'fixed_amount' OR coupon_record.type::text = 'fixed' THEN
            discount_amount := LEAST(coupon_record.value, p_order_amount);
        WHEN coupon_record.type = 'free_trial' THEN
            discount_amount := p_order_amount;
    END CASE;
    
    final_amount := p_order_amount - discount_amount;
    
    RETURN jsonb_build_object(
        'is_valid', true,
        'valid', true,
        'coupon_id', coupon_record.id,
        'coupon_name', coupon_record.name,
        'discount_amount', discount_amount,
        'final_amount', final_amount,
        'original_amount', p_order_amount
    );
END;
$$ LANGUAGE plpgsql;

-- Simple function to apply coupon
CREATE OR REPLACE FUNCTION apply_coupon(
    p_coupon_code VARCHAR(50),
    p_user_id UUID,
    p_order_amount DECIMAL(10,2),
    p_subscription_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    validation_result JSONB;
    coupon_record coupons%ROWTYPE;
    usage_record_id UUID;
BEGIN
    -- Validate coupon
    validation_result := validate_coupon(p_coupon_code, p_user_id, p_order_amount);
    
    IF NOT (validation_result->>'is_valid')::BOOLEAN THEN
        RETURN validation_result;
    END IF;
    
    -- Get coupon
    SELECT * INTO coupon_record FROM coupons WHERE code = p_coupon_code;
    
    -- Create usage record
    INSERT INTO coupon_usage (
        coupon_id, user_id, subscription_id, original_amount, discount_amount, final_amount
    ) VALUES (
        coupon_record.id, p_user_id, p_subscription_id, p_order_amount,
        (validation_result->>'discount_amount')::DECIMAL(10,2),
        (validation_result->>'final_amount')::DECIMAL(10,2)
    ) RETURNING id INTO usage_record_id;
    
    -- Update coupon usage count
    UPDATE coupons 
    SET usage_count = usage_count + 1,
        updated_at = NOW()
    WHERE id = coupon_record.id;
    
    RETURN jsonb_build_object(
        'is_valid', true,
        'valid', true,
        'usage_record_id', usage_record_id,
        'discount_amount', validation_result->>'discount_amount',
        'final_amount', validation_result->>'final_amount',
        'original_amount', validation_result->>'original_amount'
    );
END;
$$ LANGUAGE plpgsql;

-- Insert sample coupon for 3-month plans
INSERT INTO coupons (
    code, name, description, type, value, min_order_amount,
    valid_from, valid_until, usage_limit, usage_limit_per_user, is_active
) VALUES 
('FREE3MONTHS', '3-Month Free Trial', '100% discount on 3-month subscription plans', 'percentage', 100.00, 0.00,
 NOW(), NOW() + INTERVAL '1 year', 1000, 1, true)
ON CONFLICT (code) DO NOTHING;

-- Success message
SELECT 'Simple Coupon System setup completed successfully!' as message;
