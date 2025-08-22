-- Migration: Add message_type field to messages table
-- This enables better categorization of automated vs user messages

-- Step 1: Add message_type field without constraint first
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS message_type TEXT;

-- Step 2: Update existing messages to have proper message_type
-- Set all existing messages to 'user_input' as default
UPDATE messages 
SET message_type = 'user_input' 
WHERE message_type IS NULL;

-- Step 3: Now set the default value for future messages
ALTER TABLE messages 
ALTER COLUMN message_type SET DEFAULT 'user_input';

-- Step 4: Make the column NOT NULL after all data is updated
ALTER TABLE messages 
ALTER COLUMN message_type SET NOT NULL;

-- Step 5: Now add the constraint safely
ALTER TABLE messages 
ADD CONSTRAINT check_message_type 
CHECK (message_type IN ('user_input', 'automated', 'system'));

-- Step 6: Add index for better performance
CREATE INDEX IF NOT EXISTS idx_messages_message_type ON messages(message_type);

-- Step 7: Verify the changes
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'messages' AND column_name = 'message_type';

-- Step 8: Verify constraint exists
SELECT 
    constraint_name,
    constraint_type,
    check_clause
FROM information_schema.check_constraints 
WHERE constraint_name = 'check_message_type';
