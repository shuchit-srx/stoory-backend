-- Add FCM tokens table for push notifications
CREATE TABLE fcm_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_type TEXT CHECK (device_type IN ('web', 'android', 'ios')),
    device_id TEXT, -- Optional device identifier
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique token per user-device combination
    UNIQUE(user_id, token)
);

-- Create indexes for better performance
CREATE INDEX idx_fcm_tokens_user_id ON fcm_tokens(user_id);
CREATE INDEX idx_fcm_tokens_active ON fcm_tokens(is_active);
CREATE INDEX idx_fcm_tokens_last_used ON fcm_tokens(last_used_at);

-- Create unique partial index for device_id (only when device_id is not null)
CREATE UNIQUE INDEX idx_fcm_tokens_user_device_unique 
ON fcm_tokens(user_id, device_id) 
WHERE device_id IS NOT NULL;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_fcm_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_fcm_tokens_updated_at
    BEFORE UPDATE ON fcm_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_fcm_tokens_updated_at();
