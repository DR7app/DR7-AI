-- Add customer_phone and customer_email columns to fatture table
ALTER TABLE fatture 
ADD COLUMN IF NOT EXISTS customer_phone TEXT,
ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Add comment
COMMENT ON COLUMN fatture.customer_phone IS 'Customer phone number';
COMMENT ON COLUMN fatture.customer_email IS 'Customer email address';
