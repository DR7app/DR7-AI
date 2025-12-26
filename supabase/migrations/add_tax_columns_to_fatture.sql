-- Add tax fields to fatture table if they don't exist
ALTER TABLE fatture 
ADD COLUMN IF NOT EXISTS customer_tax_code TEXT,
ADD COLUMN IF NOT EXISTS customer_vat TEXT;

-- Add comments
COMMENT ON COLUMN fatture.customer_tax_code IS 'Customer Tax Code (Codice Fiscale)';
COMMENT ON COLUMN fatture.customer_vat IS 'Customer VAT Number (Partita IVA)';
