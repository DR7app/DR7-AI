-- Migration: Add new fields for Azienda (Company)
-- Date: 2025-12-07
-- Description: Adds sede legale, sede operativa, and legal representative information for companies

-- Add new columns to customers_extended table for Azienda
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS sede_legale TEXT,
ADD COLUMN IF NOT EXISTS sede_operativa TEXT,
ADD COLUMN IF NOT EXISTS nome_rappresentante VARCHAR(255),
ADD COLUMN IF NOT EXISTS cognome_rappresentante VARCHAR(255),
ADD COLUMN IF NOT EXISTS cf_rappresentante VARCHAR(16),
ADD COLUMN IF NOT EXISTS ruolo_rappresentante VARCHAR(255),
ADD COLUMN IF NOT EXISTS tipo_documento_rappresentante VARCHAR(50),
ADD COLUMN IF NOT EXISTS numero_documento_rappresentante VARCHAR(100),
ADD COLUMN IF NOT EXISTS data_rilascio_documento DATE,
ADD COLUMN IF NOT EXISTS luogo_rilascio_documento VARCHAR(255);

-- Add comments to document the new columns
COMMENT ON COLUMN customers_extended.sede_legale IS 'Legal headquarters address - for Azienda';
COMMENT ON COLUMN customers_extended.sede_operativa IS 'Operating headquarters address (if different) - for Azienda';
COMMENT ON COLUMN customers_extended.nome_rappresentante IS 'Legal representative first name - for Azienda';
COMMENT ON COLUMN customers_extended.cognome_rappresentante IS 'Legal representative last name - for Azienda';
COMMENT ON COLUMN customers_extended.cf_rappresentante IS 'Legal representative tax code (Codice Fiscale) - for Azienda';
COMMENT ON COLUMN customers_extended.ruolo_rappresentante IS 'Legal representative role in company (e.g., Amministratore Unico) - for Azienda';
COMMENT ON COLUMN customers_extended.tipo_documento_rappresentante IS 'Legal representative ID document type (CI, Patente, Passaporto) - for Azienda';
COMMENT ON COLUMN customers_extended.numero_documento_rappresentante IS 'Legal representative ID document number - for Azienda';
COMMENT ON COLUMN customers_extended.data_rilascio_documento IS 'Legal representative ID document issue date - for Azienda';
COMMENT ON COLUMN customers_extended.luogo_rilascio_documento IS 'Legal representative ID document issue place - for Azienda';

-- Create index for faster searches on legal representative
CREATE INDEX IF NOT EXISTS idx_customers_extended_cf_rappresentante ON customers_extended(cf_rappresentante);

-- Note: The existing column "indirizzo" or "indirizzo_azienda" has been replaced by "sede_legale" and "sede_operativa"
-- for better clarity and to distinguish between legal and operational headquarters
