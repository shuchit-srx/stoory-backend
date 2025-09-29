-- Add Essential User Fields Migration
-- This migration adds only the essential fields needed for basic user functionality

-- Create custom types for verification (only if they don't exist)
DO $$ BEGIN
    CREATE TYPE verification_status AS ENUM ('pending', 'under_review', 'verified', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE verification_document_type AS ENUM ('pan_card', 'aadhaar_card', 'passport', 'driving_license', 'voter_id');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE social_platform AS ENUM ('instagram', 'facebook', 'youtube', 'tiktok', 'twitter');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add essential fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS pan_number TEXT,
ADD COLUMN IF NOT EXISTS verification_image_url TEXT,
ADD COLUMN IF NOT EXISTS verification_document_type verification_document_type,
ADD COLUMN IF NOT EXISTS verification_status verification_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verification_profile JSONB;

-- Enhance social_platforms table with simplified fields
ALTER TABLE social_platforms 
ADD COLUMN IF NOT EXISTS platform social_platform,
ADD COLUMN IF NOT EXISTS username TEXT,
ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT TRUE;

-- Add constraints to social_platforms table (only if they don't exist)
DO $$ BEGIN
    ALTER TABLE social_platforms ADD CONSTRAINT check_platform_username CHECK (username IS NOT NULL AND LENGTH(username) > 0);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE social_platforms ADD CONSTRAINT check_followers_count CHECK (followers_count IS NOT NULL AND followers_count >= 0);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_date_of_birth ON users(date_of_birth);
CREATE INDEX IF NOT EXISTS idx_users_verification_status ON users(verification_status);
CREATE INDEX IF NOT EXISTS idx_users_is_verified ON users(is_verified);
CREATE INDEX IF NOT EXISTS idx_users_pan_number ON users(pan_number);
CREATE INDEX IF NOT EXISTS idx_social_platforms_platform ON social_platforms(platform);
CREATE INDEX IF NOT EXISTS idx_social_platforms_username ON social_platforms(username);
CREATE INDEX IF NOT EXISTS idx_social_platforms_is_connected ON social_platforms(is_connected);

-- Add comments for documentation
COMMENT ON COLUMN users.date_of_birth IS 'User date of birth';
COMMENT ON COLUMN users.pan_number IS 'PAN number for verification';
COMMENT ON COLUMN users.verification_status IS 'Current verification status';
COMMENT ON COLUMN users.is_verified IS 'Boolean flag for verification status';
COMMENT ON COLUMN users.verification_profile IS 'Verification profile data used during registration flow - not displayed in regular profile';

COMMENT ON COLUMN social_platforms.platform IS 'Social media platform name';
COMMENT ON COLUMN social_platforms.username IS 'Username/handle on the platform';
COMMENT ON COLUMN social_platforms.is_connected IS 'Whether the platform account is currently connected';

-- Update existing social platforms to have default values
UPDATE social_platforms 
SET is_connected = TRUE
WHERE is_connected IS NULL;

COMMIT;
