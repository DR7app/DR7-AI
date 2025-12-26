-- Add customer contact columns to fatture table
ALTER TABLE fatture 
ADD COLUMN IF NOT EXISTS customer_address TEXT,
ADD COLUMN IF NOT EXISTS customer_phone TEXT,
ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Add comments
COMMENT ON COLUMN fatture.customer_address IS 'Customer full address';
COMMENT ON COLUMN fatture.customer_phone IS 'Customer phone number';
COMMENT ON COLUMN fatture.customer_email IS 'Customer email address';
