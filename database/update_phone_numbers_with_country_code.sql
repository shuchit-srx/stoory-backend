-- Update existing user phone numbers to add +91 country code
-- This script will add +91 prefix to phone numbers that don't already have a country code

-- First, let's see what phone numbers we currently have
SELECT 
    id, 
    phone, 
    name,
    created_at
FROM users 
WHERE phone IS NOT NULL 
ORDER BY created_at DESC
LIMIT 10;

-- Update phone numbers that don't start with + (assuming they are Indian numbers)
-- This will add +91 prefix to numbers that don't already have a country code
UPDATE users 
SET phone = '+91' || phone
WHERE phone IS NOT NULL 
  AND phone != ''
  AND NOT phone LIKE '+%'
  AND LENGTH(phone) >= 10  -- Ensure it's a valid phone number length
  AND phone ~ '^[0-9]+$';  -- Ensure it contains only digits

-- Update the updated_at timestamp
UPDATE users 
SET updated_at = NOW()
WHERE phone LIKE '+91%' 
  AND updated_at < NOW() - INTERVAL '1 minute';

-- Verify the changes
SELECT 
    id, 
    phone, 
    name,
    created_at,
    updated_at
FROM users 
WHERE phone LIKE '+91%'
ORDER BY updated_at DESC
LIMIT 10;

-- Show count of updated records
SELECT 
    COUNT(*) as total_users,
    COUNT(CASE WHEN phone LIKE '+91%' THEN 1 END) as users_with_country_code,
    COUNT(CASE WHEN phone LIKE '+%' AND phone NOT LIKE '+91%' THEN 1 END) as users_with_other_country_codes,
    COUNT(CASE WHEN phone NOT LIKE '+%' THEN 1 END) as users_without_country_code
FROM users 
WHERE phone IS NOT NULL AND phone != '';

-- Optional: If you want to be more specific and only update certain patterns
-- Uncomment the following if you want to be more selective:

-- UPDATE users 
-- SET phone = '+91' || phone
-- WHERE phone IS NOT NULL 
--   AND phone != ''
--   AND NOT phone LIKE '+%'
--   AND LENGTH(phone) = 10  -- Only 10-digit numbers
--   AND phone ~ '^[6-9][0-9]{9}$';  -- Indian mobile number pattern (starts with 6-9)

-- Show any potential issues or conflicts
SELECT 
    phone,
    COUNT(*) as count
FROM users 
WHERE phone IS NOT NULL
GROUP BY phone
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- Show users with invalid phone formats after update
SELECT 
    id,
    phone,
    name
FROM users 
WHERE phone IS NOT NULL 
  AND (
    phone NOT LIKE '+%' OR  -- No country code
    LENGTH(phone) < 12 OR   -- Too short (should be at least +91 + 10 digits)
    phone !~ '^\+[1-9][0-9]{6,14}$'  -- Invalid international format
  )
ORDER BY created_at DESC;
