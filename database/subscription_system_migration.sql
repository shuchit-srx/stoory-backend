-- Subscription System Migration
-- This migration adds subscription functionality for brand owners

-- Create plans table
CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    period TEXT NOT NULL,
    description TEXT,
    highlight BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create subscriptions table
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'cancelled', 'pending')),
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    razorpay_subscription_id TEXT,
    razorpay_payment_id TEXT,
    amount_paid DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, status) -- Only one active subscription per user
);

-- Insert default plans
INSERT INTO plans (id, name, price, period, description, highlight) VALUES
('10days', '10 Days Trial', 199.00, '10 days', 'Short-term access for quick needs', false),
('1month', '1 Month', 499.00, '1 month', 'Best for trying out all features', false),
('3months', '3 Months', 1200.00, '3 months', 'Save more with a quarterly plan', false),
('6months', '6 Months', 2500.00, '6 months', 'Half-year access at a great value', false),
('1year', '1 Year', 4999.00, '1 year', 'Best value for long-term users', true);

-- Create indexes for better performance
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_end_date ON subscriptions(end_date);
CREATE INDEX idx_plans_active ON plans(is_active);

-- Enable Row Level Security
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for plans table (READ ONLY for all authenticated users)
CREATE POLICY "All authenticated users can view active plans" ON plans
    FOR SELECT USING (
        is_active = true AND auth.uid() IS NOT NULL
    );

-- RLS Policies for subscriptions table
CREATE POLICY "Users can view own subscriptions" ON subscriptions
    FOR SELECT USING (
        auth.uid()::text = user_id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );
CREATE POLICY "Users can create own subscriptions" ON subscriptions
    FOR INSERT WITH CHECK (
        auth.uid()::text = user_id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );
CREATE POLICY "Users can update own subscriptions" ON subscriptions
    FOR UPDATE USING (
        auth.uid()::text = user_id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );

-- Create trigger for updated_at
CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to check if user has active premium subscription
CREATE OR REPLACE FUNCTION has_active_premium_subscription(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    subscription_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM subscriptions 
        WHERE user_id = user_uuid 
        AND status = 'active' 
        AND end_date > NOW() + INTERVAL '2 days' -- 2 days grace period
    ) INTO subscription_exists;
    
    RETURN subscription_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user subscription status
CREATE OR REPLACE FUNCTION get_user_subscription_status(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
    subscription_data JSON;
BEGIN
    SELECT json_build_object(
        'has_active_subscription', has_active_premium_subscription(user_uuid),
        'subscription', json_build_object(
            'id', s.id,
            'plan_id', s.plan_id,
            'plan_name', p.name,
            'status', s.status,
            'start_date', s.start_date,
            'end_date', s.end_date,
            'amount_paid', s.amount_paid
        )
    ) INTO subscription_data
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.user_id = user_uuid 
    AND s.status = 'active'
    ORDER BY s.created_at DESC
    LIMIT 1;
    
    RETURN COALESCE(subscription_data, json_build_object('has_active_subscription', false, 'subscription', null));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
