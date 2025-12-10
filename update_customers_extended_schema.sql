-- ============================================
-- Add Missing Columns to customers_extended Table
-- Run this AFTER fixing RLS policies
-- ============================================

-- Add metadata column for storing extended data (patente, rappresentante, etc.)
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add missing Persona Fisica fields
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS sesso TEXT,
ADD COLUMN IF NOT EXISTS provincia_nascita TEXT,
ADD COLUMN IF NOT EXISTS numero_patente TEXT,
ADD COLUMN IF NOT EXISTS data_rilascio_patente DATE,
ADD COLUMN IF NOT EXISTS scadenza_patente DATE,
ADD COLUMN IF NOT EXISTS emessa_da TEXT,
ADD COLUMN IF NOT EXISTS tipo_patente TEXT;

-- Add missing Azienda fields
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS sede_legale TEXT,
ADD COLUMN IF NOT EXISTS sede_operativa TEXT,
ADD COLUMN IF NOT EXISTS indirizzo_ddt TEXT,
ADD COLUMN IF NOT EXISTS contatti_cliente TEXT;

-- Add missing common fields
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS codice_postale TEXT,
ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('blacklist', 'has_rental', 'vip'));

-- Add missing PA field
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS ente_o_ufficio TEXT;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_customers_extended_status ON customers_extended(status);
CREATE INDEX IF NOT EXISTS idx_customers_extended_nome ON customers_extended(nome);
CREATE INDEX IF NOT EXISTS idx_customers_extended_cognome ON customers_extended(cognome);
CREATE INDEX IF NOT EXISTS idx_customers_extended_telefono ON customers_extended(telefono);

-- Add comments to document columns
COMMENT ON COLUMN customers_extended.metadata IS 'Extended data stored as JSON (patente details, rappresentante info, etc.)';
COMMENT ON COLUMN customers_extended.sesso IS 'Gender: M, F, or Altro';
COMMENT ON COLUMN customers_extended.provincia_nascita IS 'Province of birth (2-letter code)';
COMMENT ON COLUMN customers_extended.numero_patente IS 'Driver license number';
COMMENT ON COLUMN customers_extended.status IS 'Customer status: blacklist, has_rental, vip, or NULL';

-- Verify all columns exist
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'customers_extended'
AND column_name IN (
  'metadata', 'sesso', 'provincia_nascita', 'numero_patente', 
  'data_rilascio_patente', 'scadenza_patente', 'emessa_da', 'tipo_patente',
  'sede_legale', 'sede_operativa', 'indirizzo_ddt', 'contatti_cliente',
  'codice_postale', 'status', 'ente_o_ufficio'
)
ORDER BY column_name;

-- ============================================
-- ✅ Schema Updated Successfully!
-- All required columns have been added to customers_extended
-- ============================================
