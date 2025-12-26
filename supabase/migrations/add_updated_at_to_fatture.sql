-- Add updated_at trigger to fatture table
-- This ensures the updated_at column is automatically updated when a row is modified

-- Create or replace the trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at column if it doesn't exist
ALTER TABLE fatture 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_fatture_updated_at ON fatture;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_fatture_updated_at
    BEFORE UPDATE ON fatture
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON COLUMN fatture.updated_at IS 'Timestamp of last update to this invoice';
