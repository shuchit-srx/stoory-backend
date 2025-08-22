-- Migration: Add automated message fields to messages table
-- This enables the automated conversation flow system

-- Add missing fields for automated messages
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS action_required BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS action_data JSONB DEFAULT '{}';

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_action_required ON messages(action_required);
CREATE INDEX IF NOT EXISTS idx_messages_action_data ON messages USING GIN(action_data);

-- Update existing messages to have proper values
UPDATE messages 
SET 
    action_required = FALSE,
    action_data = '{}'
WHERE action_required IS NULL;

-- Verify the changes
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'messages' 
AND column_name IN ('action_required', 'action_data')
ORDER BY ordinal_position;

-- Migration completed successfully!
-- The messages table now has all fields needed for:
-- 1. Action requirement tracking (action_required)
-- 2. Action data storage (action_data) for buttons, inputs, etc.
-- 3. Automated message handling
