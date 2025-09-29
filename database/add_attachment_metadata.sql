-- Add attachment metadata column to messages table
-- This will store detailed information about file attachments

ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS attachment_metadata JSONB;

-- Add index for better query performance on attachment metadata
CREATE INDEX IF NOT EXISTS idx_messages_attachment_metadata 
ON messages USING GIN (attachment_metadata);

-- Add comment to explain the column
COMMENT ON COLUMN messages.attachment_metadata IS 'JSON metadata for file attachments including file type, size, preview info, etc.';

-- Example of what attachment_metadata might contain:
-- {
--   "fileName": "document.pdf",
--   "fileType": "document",
--   "mimeType": "application/pdf",
--   "size": 1024000,
--   "preview": {
--     "type": "document",
--     "fileName": "document.pdf",
--     "size": 1024000,
--     "url": "https://storage.supabase.co/attachments/...",
--     "canPreview": false,
--     "thumbnail": null,
--     "icon": "📄"
--   }
-- }
