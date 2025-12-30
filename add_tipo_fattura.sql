-- Add tipo_fattura column to fatture table if it doesn't exist
ALTER TABLE fatture 
ADD COLUMN IF NOT EXISTS tipo_fattura VARCHAR(50) DEFAULT 'standard';

-- Update existing invoices to be 'standard'
UPDATE fatture 
SET tipo_fattura = 'standard' 
WHERE tipo_fattura IS NULL;

-- Notify Supabase to reload schema cache (usually happens automatically but good to force on DDL)
NOTIFY pgrst, 'reload schema';
