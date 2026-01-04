-- Add note column to customers_extended table
-- This allows storing internal notes about customers

ALTER TABLE customers_extended 
ADD COLUMN IF NOT EXISTS note TEXT;

-- Add comment to document the column
COMMENT ON COLUMN customers_extended.note IS 'Internal notes about the customer';
