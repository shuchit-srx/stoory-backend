-- Add brand profile fields to users table for brand owners
-- Safe to run multiple times

ALTER TABLE IF EXISTS public.users
  ADD COLUMN IF NOT EXISTS brand_name TEXT,
  ADD COLUMN IF NOT EXISTS brand_description TEXT,
  ADD COLUMN IF NOT EXISTS brand_profile_image_url TEXT;

-- Helpful index for searching/filtering by brand_name
CREATE INDEX IF NOT EXISTS idx_users_brand_name ON public.users(brand_name);

COMMENT ON COLUMN public.users.brand_name IS 'Brand name for brand owners';
COMMENT ON COLUMN public.users.brand_description IS 'Brand description for brand owners';
COMMENT ON COLUMN public.users.brand_profile_image_url IS 'Primary brand profile image; mirrors to profile_image_url when present';




