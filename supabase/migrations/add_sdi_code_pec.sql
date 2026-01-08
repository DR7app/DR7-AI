-- Add SDI Code and PEC columns to fatture table
ALTER TABLE public.fatture
ADD COLUMN IF NOT EXISTS customer_sdi_code TEXT DEFAULT '0000000',
ADD COLUMN IF NOT EXISTS customer_pec TEXT;

COMMENT ON COLUMN fatture.customer_sdi_code IS 'Codice Destinatario (SDI Code). Default 0000000 for individuals.';
COMMENT ON COLUMN fatture.customer_pec IS 'PEC (Certified Email). Optional.';
