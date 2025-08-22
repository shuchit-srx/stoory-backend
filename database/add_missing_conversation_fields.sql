-- Migration: Add missing fields to conversations table
-- This fixes the "Failed to fetch conversations" error

-- Add missing fields to conversations table
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS chat_status TEXT DEFAULT 'realtime',
ADD COLUMN IF NOT EXISTS payment_required BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS payment_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add constraint for chat_status
ALTER TABLE conversations 
ADD CONSTRAINT check_chat_status 
CHECK (chat_status IN ('automated', 'realtime', 'completed'));

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists to avoid conflicts
DROP TRIGGER IF EXISTS trigger_update_conversations_updated_at ON conversations;

-- Create trigger
CREATE TRIGGER trigger_update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_conversations_updated_at();

-- Update existing conversations to have proper values
UPDATE conversations 
SET 
    chat_status = 'realtime',
    payment_required = FALSE,
    payment_completed = FALSE,
    updated_at = created_at
WHERE chat_status IS NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conversations_chat_status ON conversations(chat_status);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_payment_status ON conversations(payment_required, payment_completed);

-- Verify the changes
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'conversations' 
ORDER BY ordinal_position;
