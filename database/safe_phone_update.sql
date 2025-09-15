-- SAFE PHONE NUMBER UPDATE SCRIPT
-- Run these commands one by one to safely update phone numbers

-- Step 1: Check current phone number formats
SELECT 
    'Current phone number formats:' as info,
    phone,
    COUNT(*) as user_count
FROM users 
WHERE phone IS NOT NULL 
GROUP BY phone
ORDER BY user_count DESC
LIMIT 20;

-- Step 2: Check for potential conflicts before updating
SELECT 
    'Potential conflicts (duplicate +91 numbers):' as info,
    '+91' || phone as new_phone,
    COUNT(*) as conflict_count
FROM users 
WHERE phone IS NOT NULL 
  AND NOT phone LIKE '+%'
  AND LENGTH(phone) >= 10
GROUP BY '+91' || phone
HAVING COUNT(*) > 1;

-- Step 3: Preview what will be updated (DRY RUN)
SELECT 
    'Preview of updates:' as info,
    id,
    phone as current_phone,
    '+91' || phone as new_phone,
    name
FROM users 
WHERE phone IS NOT NULL 
  AND NOT phone LIKE '+%'
  AND LENGTH(phone) >= 10
  AND phone ~ '^[0-9]+$'
ORDER BY created_at DESC
LIMIT 10;

-- Step 4: ACTUAL UPDATE (only run this after reviewing the preview)
-- UPDATE users 
-- SET phone = '+91' || phone,
--     updated_at = NOW()
-- WHERE phone IS NOT NULL 
--   AND NOT phone LIKE '+%'
--   AND LENGTH(phone) >= 10
--   AND phone ~ '^[0-9]+$';

-- Step 5: Verify the update results
-- SELECT 
--     'After update verification:' as info,
--     phone,
--     COUNT(*) as user_count
-- FROM users 
-- WHERE phone IS NOT NULL 
-- GROUP BY phone
-- ORDER BY user_count DESC
-- LIMIT 20;

-- Step 6: Check for any remaining issues
-- SELECT 
--     'Remaining issues:' as info,
--     id,
--     phone,
--     name
-- FROM users 
-- WHERE phone IS NOT NULL 
--   AND (
--     phone NOT LIKE '+%' OR
--     LENGTH(phone) < 12 OR
--     phone !~ '^\+[1-9][0-9]{6,14}$'
--   )
-- ORDER BY created_at DESC;
