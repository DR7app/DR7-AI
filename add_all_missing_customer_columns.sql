-- ============================================
-- Add ALL Missing Columns to customers_extended
-- Comprehensive schema update for all customer types
-- ============================================

-- Persona Fisica additional fields
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS data_nascita DATE,
ADD COLUMN IF NOT EXISTS luogo_nascita TEXT,
ADD COLUMN IF NOT EXISTS citta_nascita TEXT,
ADD COLUMN IF NOT EXISTS citta_residenza TEXT,
ADD COLUMN IF NOT EXISTS provincia_residenza TEXT,
ADD COLUMN IF NOT EXISTS numero_civico TEXT;

-- Azienda additional fields  
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS denominazione TEXT,
ADD COLUMN IF NOT EXISTS nome_rappresentante TEXT,
ADD COLUMN IF NOT EXISTS cognome_rappresentante TEXT,
ADD COLUMN IF NOT EXISTS cf_rappresentante TEXT,
ADD COLUMN IF NOT EXISTS ruolo_rappresentante TEXT,
ADD COLUMN IF NOT EXISTS tipo_documento_rappresentante TEXT,
ADD COLUMN IF NOT EXISTS numero_documento_rappresentante TEXT,
ADD COLUMN IF NOT EXISTS data_rilascio_documento DATE,
ADD COLUMN IF NOT EXISTS luogo_rilascio_documento TEXT;

-- Pubblica Amministrazione additional fields
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS ente_ufficio TEXT,
ADD COLUMN IF NOT EXISTS citta TEXT,
ADD COLUMN IF NOT EXISTS codice_fiscale_pa TEXT;

-- Common additional fields
ADD COLUMN IF NOT EXISTS note TEXT;

-- Create indexes for search performance
CREATE INDEX IF NOT EXISTS idx_customers_extended_data_nascita ON customers_extended(data_nascita);
CREATE INDEX IF NOT EXISTS idx_customers_extended_citta_residenza ON customers_extended(citta_residenza);
CREATE INDEX IF NOT EXISTS idx_customers_extended_citta ON customers_extended(citta);

-- ============================================
-- ✅ All Missing Columns Added!
-- Run this in Supabase SQL Editor
-- ============================================
