-- Seed Admin User Script
-- This script creates a default admin user for the application
-- Run this script after setting up the database schema

-- Insert admin user (only if no admin exists)
INSERT INTO users (
    id,
    phone,
    name,
    email,
    role,
    gender,
    languages,
    categories,
    min_range,
    max_range,
    is_verified,
    created_at,
    updated_at
) 
SELECT 
    '00000000-0000-0000-0000-000000000001'::uuid,
    '+919999999999',
    'Admin User',
    'admin@stoory.com',
    'admin',
    'other',
    ARRAY['English', 'Hindi'],
    ARRAY['Technology', 'Business', 'Marketing'],
    0,
    999999999,
    true,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE role = 'admin'
);

-- Create admin wallet if it doesn't exist
INSERT INTO wallets (
    id,
    user_id,
    balance,
    frozen_balance,
    total_earned,
    total_spent,
    created_at,
    updated_at
)
SELECT 
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    0.00,
    0.00,
    0.00,
    0.00,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM wallets WHERE user_id = '00000000-0000-0000-0000-000000000001'::uuid
);

-- Grant admin user full access to all tables (if using RLS)
-- Note: This is handled by the RLS policies that check for admin role

-- Add admin user to FCM tokens table (optional)
-- This allows admin to receive push notifications
INSERT INTO fcm_tokens (
    id,
    user_id,
    token,
    device_type,
    is_active,
    created_at,
    updated_at
)
SELECT 
    '00000000-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'admin-mock-token',
    'web',
    true,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM fcm_tokens WHERE user_id = '00000000-0000-0000-0000-000000000001'::uuid
);

-- Display success message
DO $$
BEGIN
    RAISE NOTICE 'Admin user seeded successfully!';
    RAISE NOTICE 'Phone: +919999999999';
    RAISE NOTICE 'Email: admin@stoory.com';
    RAISE NOTICE 'Role: admin';
    RAISE NOTICE 'Use OTP: 123456 for testing';
END $$;
