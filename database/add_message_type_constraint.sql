-- Add message_type constraint after fixing existing data
-- This script can be run manually in Supabase SQL editor

-- Add check constraint for message_type
ALTER TABLE messages 
ADD CONSTRAINT check_message_type 
CHECK (message_type IN ('user_input', 'automated', 'system'));

-- Verify the constraint was added
SELECT 
    constraint_name,
    check_clause
FROM information_schema.check_constraints 
WHERE constraint_name = 'check_message_type';

-- Verify all messages have valid types
SELECT 
    message_type,
    COUNT(*) as message_count
FROM messages 
GROUP BY message_type
ORDER BY message_type;
