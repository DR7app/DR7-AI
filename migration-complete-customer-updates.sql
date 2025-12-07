-- Combined Migration: Complete Customer Updates for Persona Fisica and Azienda
-- Date: 2025-12-07
-- Description: Adds all new fields for both Persona Fisica and Azienda customer types

-- ============================================================================
-- PERSONA FISICA FIELDS
-- ============================================================================

-- Add new columns for Persona Fisica
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS sesso VARCHAR(1) CHECK (sesso IN ('M', 'F')),
ADD COLUMN IF NOT EXISTS citta_nascita VARCHAR(255),
ADD COLUMN IF NOT EXISTS provincia_nascita VARCHAR(2),
ADD COLUMN IF NOT EXISTS tipo_patente VARCHAR(10),
ADD COLUMN IF NOT EXISTS numero_patente VARCHAR(50),
ADD COLUMN IF NOT EXISTS emessa_da VARCHAR(255),
ADD COLUMN IF NOT EXISTS data_rilascio_patente DATE,
ADD COLUMN IF NOT EXISTS scadenza_patente DATE;

-- Add comments for Persona Fisica columns
COMMENT ON COLUMN customers_extended.sesso IS 'Gender: M (Maschio) or F (Femmina) - for Persona Fisica';
COMMENT ON COLUMN customers_extended.citta_nascita IS 'City of birth - for Persona Fisica';
COMMENT ON COLUMN customers_extended.provincia_nascita IS 'Province of birth (2-letter code) - for Persona Fisica';
COMMENT ON COLUMN customers_extended.tipo_patente IS 'Driving license type (AM, A1, A2, A, B1, B, BE, C1, C, CE, D1, D, DE)';
COMMENT ON COLUMN customers_extended.numero_patente IS 'Driving license number';
COMMENT ON COLUMN customers_extended.emessa_da IS 'Issued by (e.g., Motorizzazione Civile)';
COMMENT ON COLUMN customers_extended.data_rilascio_patente IS 'Driving license issue date';
COMMENT ON COLUMN customers_extended.scadenza_patente IS 'Driving license expiration date';

-- Create indexes for Persona Fisica
CREATE INDEX IF NOT EXISTS idx_customers_extended_sesso ON customers_extended(sesso);
CREATE INDEX IF NOT EXISTS idx_customers_extended_scadenza_patente ON customers_extended(scadenza_patente);

-- ============================================================================
-- AZIENDA FIELDS
-- ============================================================================

-- Add new columns for Azienda
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

-- Add comments for Azienda columns
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

-- Create indexes for Azienda
CREATE INDEX IF NOT EXISTS idx_customers_extended_cf_rappresentante ON customers_extended(cf_rappresentante);

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. The existing column "luogo_nascita" can remain for backward compatibility
--    New Persona Fisica records should use citta_nascita and provincia_nascita instead
--
-- 2. The existing column "indirizzo" or "indirizzo_azienda" has been replaced by
--    "sede_legale" and "sede_operativa" for better clarity
--
-- 3. All new fields are optional (nullable) to allow gradual data migration
