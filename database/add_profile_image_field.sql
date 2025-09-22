-- Add profile image field to users table
-- This script adds a profile_image_url field to store user profile pictures

-- Add profile_image_url column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS profile_image_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN users.profile_image_url IS 'URL of the user profile image stored in Supabase Storage';
