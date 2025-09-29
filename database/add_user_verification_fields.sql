-- Add User Verification Fields
-- This script adds missing verification fields for influencer and brand owner registration

-- 1. Add verification fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS pan_number TEXT,
ADD COLUMN IF NOT EXISTS verification_image_url TEXT,
ADD COLUMN IF NOT EXISTS verification_document_type TEXT CHECK (verification_document_type IN ('pan_card', 'aadhaar_card', 'passport', 'driving_license', 'voter_id')),
ADD COLUMN IF NOT EXISTS address_line1 TEXT,
ADD COLUMN IF NOT EXISTS address_line2 TEXT,
ADD COLUMN IF NOT EXISTS address_city TEXT,
ADD COLUMN IF NOT EXISTS address_state TEXT,
ADD COLUMN IF NOT EXISTS address_pincode TEXT,
ADD COLUMN IF NOT EXISTS address_country TEXT DEFAULT 'India',
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'under_review', 'verified', 'rejected')),
ADD COLUMN IF NOT EXISTS verification_notes TEXT,
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS business_name TEXT,
ADD COLUMN IF NOT EXISTS business_type TEXT CHECK (business_type IN ('individual', 'partnership', 'private_limited', 'public_limited', 'llp', 'sole_proprietorship')),
ADD COLUMN IF NOT EXISTS gst_number TEXT,
ADD COLUMN IF NOT EXISTS business_registration_number TEXT,
ADD COLUMN IF NOT EXISTS business_address TEXT,
ADD COLUMN IF NOT EXISTS business_website TEXT,
ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
ADD COLUMN IF NOT EXISTS emergency_contact_relation TEXT,
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS experience_years INTEGER,
ADD COLUMN IF NOT EXISTS specializations TEXT[],
ADD COLUMN IF NOT EXISTS portfolio_links TEXT[],
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verification_priority TEXT DEFAULT 'normal' CHECK (verification_priority IN ('low', 'normal', 'high', 'urgent'));

-- 2. Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_verification_status ON users(verification_status);
CREATE INDEX IF NOT EXISTS idx_users_pan_number ON users(pan_number);
CREATE INDEX IF NOT EXISTS idx_users_business_name ON users(business_name);
CREATE INDEX IF NOT EXISTS idx_users_gst_number ON users(gst_number);
CREATE INDEX IF NOT EXISTS idx_users_is_verified ON users(is_verified);
CREATE INDEX IF NOT EXISTS idx_users_verification_priority ON users(verification_priority);

-- 3. Add comments for documentation
COMMENT ON COLUMN users.pan_number IS 'PAN number for tax verification';
COMMENT ON COLUMN users.verification_image_url IS 'URL of verification document image stored in Supabase Storage';
COMMENT ON COLUMN users.verification_document_type IS 'Type of verification document submitted';
COMMENT ON COLUMN users.verification_status IS 'Current verification status of the user';
COMMENT ON COLUMN users.verification_notes IS 'Admin notes about verification process';
COMMENT ON COLUMN users.verified_at IS 'Timestamp when user was verified';
COMMENT ON COLUMN users.verified_by IS 'Admin user who verified this user';
COMMENT ON COLUMN users.business_name IS 'Business name for brand owners';
COMMENT ON COLUMN users.business_type IS 'Type of business entity';
COMMENT ON COLUMN users.gst_number IS 'GST registration number for business';
COMMENT ON COLUMN users.business_registration_number IS 'Business registration number';
COMMENT ON COLUMN users.business_address IS 'Business address';
COMMENT ON COLUMN users.business_website IS 'Business website URL';
COMMENT ON COLUMN users.emergency_contact_name IS 'Emergency contact person name';
COMMENT ON COLUMN users.emergency_contact_phone IS 'Emergency contact phone number';
COMMENT ON COLUMN users.emergency_contact_relation IS 'Relationship with emergency contact';
COMMENT ON COLUMN users.date_of_birth IS 'User date of birth';
COMMENT ON COLUMN users.bio IS 'User biography/description';
COMMENT ON COLUMN users.experience_years IS 'Years of experience in the field';
COMMENT ON COLUMN users.specializations IS 'Array of specializations/skills';
COMMENT ON COLUMN users.portfolio_links IS 'Array of portfolio/website links';
COMMENT ON COLUMN users.is_verified IS 'Boolean flag for quick verification status check';
COMMENT ON COLUMN users.verification_priority IS 'Priority level for verification processing';

-- 4. Update social_platforms table to include more comprehensive data
ALTER TABLE social_platforms 
ADD COLUMN IF NOT EXISTS platform_username TEXT,
ADD COLUMN IF NOT EXISTS platform_display_name TEXT,
ADD COLUMN IF NOT EXISTS platform_category TEXT,
ADD COLUMN IF NOT EXISTS platform_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS platform_metrics JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS platform_audience_demographics JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS platform_content_categories TEXT[],
ADD COLUMN IF NOT EXISTS platform_posting_frequency TEXT,
ADD COLUMN IF NOT EXISTS platform_engagement_metrics JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS platform_contact_email TEXT,
ADD COLUMN IF NOT EXISTS platform_contact_phone TEXT,
ADD COLUMN IF NOT EXISTS platform_website TEXT,
ADD COLUMN IF NOT EXISTS platform_bio TEXT,
ADD COLUMN IF NOT EXISTS platform_created_date DATE,
ADD COLUMN IF NOT EXISTS platform_last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS platform_is_primary BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS platform_is_active BOOLEAN DEFAULT TRUE;

-- 5. Add indexes for social_platforms
CREATE INDEX IF NOT EXISTS idx_social_platforms_platform_username ON social_platforms(platform_username);
CREATE INDEX IF NOT EXISTS idx_social_platforms_platform_verified ON social_platforms(platform_verified);
CREATE INDEX IF NOT EXISTS idx_social_platforms_platform_is_primary ON social_platforms(platform_is_primary);
CREATE INDEX IF NOT EXISTS idx_social_platforms_platform_is_active ON social_platforms(platform_is_active);

-- 6. Add comments for social_platforms new fields
COMMENT ON COLUMN social_platforms.platform_username IS 'Username/handle on the platform';
COMMENT ON COLUMN social_platforms.platform_display_name IS 'Display name on the platform';
COMMENT ON COLUMN social_platforms.platform_category IS 'Category of content (fashion, tech, food, etc.)';
COMMENT ON COLUMN social_platforms.platform_verified IS 'Whether the platform account is verified';
COMMENT ON COLUMN social_platforms.platform_metrics IS 'JSON object containing platform-specific metrics';
COMMENT ON COLUMN social_platforms.platform_audience_demographics IS 'JSON object containing audience demographics';
COMMENT ON COLUMN social_platforms.platform_content_categories IS 'Array of content categories posted';
COMMENT ON COLUMN social_platforms.platform_posting_frequency IS 'How often content is posted (daily, weekly, etc.)';
COMMENT ON COLUMN social_platforms.platform_engagement_metrics IS 'JSON object containing engagement metrics';
COMMENT ON COLUMN social_platforms.platform_contact_email IS 'Contact email for the platform account';
COMMENT ON COLUMN social_platforms.platform_contact_phone IS 'Contact phone for the platform account';
COMMENT ON COLUMN social_platforms.platform_website IS 'Website associated with the platform account';
COMMENT ON COLUMN social_platforms.platform_bio IS 'Bio/description on the platform';
COMMENT ON COLUMN social_platforms.platform_created_date IS 'Date when the platform account was created';
COMMENT ON COLUMN social_platforms.platform_is_primary IS 'Whether this is the primary platform for the user';
COMMENT ON COLUMN social_platforms.platform_is_active IS 'Whether the platform account is currently active';

-- 7. Create a function to automatically set is_verified based on verification_status
CREATE OR REPLACE FUNCTION update_verification_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Update is_verified based on verification_status
    IF NEW.verification_status = 'verified' THEN
        NEW.is_verified = TRUE;
        NEW.verified_at = NOW();
    ELSE
        NEW.is_verified = FALSE;
        NEW.verified_at = NULL;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger to automatically update verification status
CREATE TRIGGER update_verification_status_trigger
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_verification_status();

-- 9. Create a view for easy verification management
CREATE OR REPLACE VIEW user_verification_status AS
SELECT 
    u.id,
    u.name,
    u.email,
    u.phone,
    u.role,
    u.verification_status,
    u.is_verified,
    u.pan_number,
    u.business_name,
    u.verification_priority,
    u.created_at,
    u.verified_at,
    verifier.name as verified_by_name,
    COUNT(sp.id) as social_platforms_count
FROM users u
LEFT JOIN users verifier ON u.verified_by = verifier.id
LEFT JOIN social_platforms sp ON u.id = sp.user_id AND sp.platform_is_active = TRUE
WHERE u.is_deleted = FALSE
GROUP BY u.id, u.name, u.email, u.phone, u.role, u.verification_status, 
         u.is_verified, u.pan_number, u.business_name, u.verification_priority, 
         u.created_at, u.verified_at, verifier.name;

-- 10. Add RLS policies for new fields
-- Users can view their own verification data
CREATE POLICY "Users can view own verification data" ON users
    FOR SELECT USING (
        auth.uid()::text = id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );

-- Users can update their own verification data (except status changes)
CREATE POLICY "Users can update own verification data" ON users
    FOR UPDATE USING (
        auth.uid()::text = id::text OR 
        auth.jwt() ->> 'role' = 'admin'
    );

-- Only admins can update verification status
CREATE POLICY "Only admins can update verification status" ON users
    FOR UPDATE USING (
        auth.jwt() ->> 'role' = 'admin'
    ) WITH CHECK (
        auth.jwt() ->> 'role' = 'admin'
    );

-- 11. Create a function to get user verification summary
CREATE OR REPLACE FUNCTION get_user_verification_summary(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'user_id', u.id,
        'name', u.name,
        'role', u.role,
        'verification_status', u.verification_status,
        'is_verified', u.is_verified,
        'verification_priority', u.verification_priority,
        'has_pan', CASE WHEN u.pan_number IS NOT NULL THEN TRUE ELSE FALSE END,
        'has_verification_document', CASE WHEN u.verification_image_url IS NOT NULL THEN TRUE ELSE FALSE END,
        'has_business_details', CASE WHEN u.business_name IS NOT NULL THEN TRUE ELSE FALSE END,
        'has_social_platforms', CASE WHEN EXISTS(SELECT 1 FROM social_platforms WHERE user_id = u.id AND platform_is_active = TRUE) THEN TRUE ELSE FALSE END,
        'social_platforms_count', (SELECT COUNT(*) FROM social_platforms WHERE user_id = u.id AND platform_is_active = TRUE),
        'verification_completeness', (
            CASE WHEN u.pan_number IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN u.verification_image_url IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN u.address_line1 IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN u.bio IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN EXISTS(SELECT 1 FROM social_platforms WHERE user_id = u.id AND platform_is_active = TRUE) THEN 1 ELSE 0 END
        ) * 20
    ) INTO result
    FROM users u
    WHERE u.id = user_uuid;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 12. Grant necessary permissions
GRANT SELECT ON user_verification_status TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_verification_summary(UUID) TO authenticated;
