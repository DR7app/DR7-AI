-- Migration: Add new fields for Persona Fisica
-- Date: 2025-12-07
-- Description: Adds gender, separate birth city/province fields, and driving license information

-- Add new columns to customers_extended table for Persona Fisica
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS sesso VARCHAR(1) CHECK (sesso IN ('M', 'F')),
ADD COLUMN IF NOT EXISTS citta_nascita VARCHAR(255),
ADD COLUMN IF NOT EXISTS provincia_nascita VARCHAR(2),
ADD COLUMN IF NOT EXISTS tipo_patente VARCHAR(10),
ADD COLUMN IF NOT EXISTS numero_patente VARCHAR(50),
ADD COLUMN IF NOT EXISTS emessa_da VARCHAR(255),
ADD COLUMN IF NOT EXISTS data_rilascio_patente DATE,
ADD COLUMN IF NOT EXISTS scadenza_patente DATE;

-- Add comments to document the new columns
COMMENT ON COLUMN customers_extended.sesso IS 'Gender: M (Maschio) or F (Femmina) - for Persona Fisica';
COMMENT ON COLUMN customers_extended.citta_nascita IS 'City of birth - for Persona Fisica';
COMMENT ON COLUMN customers_extended.provincia_nascita IS 'Province of birth (2-letter code) - for Persona Fisica';
COMMENT ON COLUMN customers_extended.tipo_patente IS 'Driving license type (AM, A1, A2, A, B1, B, BE, C1, C, CE, D1, D, DE)';
COMMENT ON COLUMN customers_extended.numero_patente IS 'Driving license number';
COMMENT ON COLUMN customers_extended.emessa_da IS 'Issued by (e.g., Motorizzazione Civile)';
COMMENT ON COLUMN customers_extended.data_rilascio_patente IS 'Driving license issue date';
COMMENT ON COLUMN customers_extended.scadenza_patente IS 'Driving license expiration date';

-- Create index for faster searches on gender
CREATE INDEX IF NOT EXISTS idx_customers_extended_sesso ON customers_extended(sesso);

-- Create index for license expiration to help identify expired licenses
CREATE INDEX IF NOT EXISTS idx_customers_extended_scadenza_patente ON customers_extended(scadenza_patente);

-- Note: The existing column "luogo_nascita" can remain for backward compatibility
-- New records should use citta_nascita and provincia_nascita instead
