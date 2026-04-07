-- =====================================================
-- HARDENING: Add unique constraints on customers_extended
-- =====================================================
-- These partial unique indexes prevent duplicate customers
-- at the database level as a final safety net.
-- They only apply when the field is NOT NULL and NOT empty.
-- =====================================================

-- Unique index on email (case-insensitive, only when not empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_extended_unique_email
ON customers_extended (LOWER(email))
WHERE email IS NOT NULL AND email != '';

-- Unique index on codice_fiscale (case-insensitive, only when not empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_extended_unique_cf
ON customers_extended (UPPER(codice_fiscale))
WHERE codice_fiscale IS NOT NULL AND codice_fiscale != '';

-- Unique index on partita_iva (only when not empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_extended_unique_piva
ON customers_extended (partita_iva)
WHERE partita_iva IS NOT NULL AND partita_iva != '';

-- Unique index on telefono (only when not empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_extended_unique_phone
ON customers_extended (telefono)
WHERE telefono IS NOT NULL AND telefono != '';

-- Add comment for documentation
COMMENT ON INDEX idx_customers_extended_unique_email IS 'Prevents duplicate customers with the same email';
COMMENT ON INDEX idx_customers_extended_unique_cf IS 'Prevents duplicate customers with the same codice fiscale';
COMMENT ON INDEX idx_customers_extended_unique_piva IS 'Prevents duplicate customers with the same partita IVA';
COMMENT ON INDEX idx_customers_extended_unique_phone IS 'Prevents duplicate customers with the same phone number';
