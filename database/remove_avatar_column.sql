-- Remove avatar column from users table
-- This removes the duplicate avatar column since profile_image_url already exists

-- Drop the avatar column
ALTER TABLE users DROP COLUMN IF EXISTS avatar;

-- Drop any indexes related to avatar column
DROP INDEX IF EXISTS idx_users_avatar;

COMMIT;
