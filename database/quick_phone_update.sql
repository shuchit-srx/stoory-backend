-- Quick one-liner to add +91 to existing phone numbers
-- Run this in your Supabase SQL editor

UPDATE users 
SET phone = '+91' || phone, updated_at = NOW()
WHERE phone IS NOT NULL 
  AND NOT phone LIKE '+%'
  AND LENGTH(phone) >= 10
  AND phone ~ '^[0-9]+$';
