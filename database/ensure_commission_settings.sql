-- Ensure commission_settings table exists with a default active record

-- Create table if missing
CREATE TABLE IF NOT EXISTS commission_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    commission_percentage DECIMAL(5,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Insert default 10% active commission if none active exists
INSERT INTO commission_settings (commission_percentage, is_active)
SELECT 10.00, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM commission_settings WHERE is_active = TRUE
);

-- Optional: enable RLS and policies for admins (idempotent)
ALTER TABLE commission_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins can manage commission settings" ON commission_settings
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM users 
        WHERE users.id = auth.uid() 
        AND users.role = 'admin'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view active commission settings" ON commission_settings
    FOR SELECT USING (is_active = TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


