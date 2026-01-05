-- ============================================
-- MERGE DUPLICATE CUSTOMERS IN customers_extended ONLY
-- This script ONLY works on customers_extended table
-- Does NOT touch the old customers table
-- ============================================

BEGIN;

-- Create a temporary table to store merge mappings
CREATE TEMP TABLE customer_merge_map (
  duplicate_id UUID,
  primary_id UUID,
  merge_reason TEXT
);

-- ============================================
-- STEP 1: Identify duplicates by VALID email
-- Keep the MOST COMPLETE record as primary
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT 
  ce.id as duplicate_id,
  (
    SELECT id 
    FROM customers_extended ce2 
    WHERE ce2.email = ce.email
      AND ce2.email IS NOT NULL 
      AND ce2.email != '' 
      AND ce2.email NOT LIKE '%placeholder%'
      AND ce2.email NOT LIKE '%noemail%'
      AND ce2.email NOT LIKE '%@example.com%'
      AND ce2.email != '-@gmail.com'
      AND ce2.email NOT LIKE '-%'
      AND LENGTH(ce2.email) > 5
      AND ce2.email LIKE '%@%.%'
    ORDER BY 
      (CASE WHEN ce2.nome IS NOT NULL AND ce2.nome != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.cognome IS NOT NULL AND ce2.cognome != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_fiscale IS NOT NULL AND ce2.codice_fiscale != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.patente IS NOT NULL AND ce2.patente != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.telefono IS NOT NULL AND ce2.telefono != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND ce2.indirizzo != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.ragione_sociale IS NOT NULL AND ce2.ragione_sociale != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.partita_iva IS NOT NULL AND ce2.partita_iva != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.user_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'duplicate_email' as merge_reason
FROM customers_extended ce
WHERE ce.email IS NOT NULL 
  AND ce.email != '' 
  AND ce.email NOT LIKE '%placeholder%'
  AND ce.email NOT LIKE '%noemail%'
  AND ce.email NOT LIKE '%@example.com%'
  AND ce.email != '-@gmail.com'
  AND ce.email NOT LIKE '-%'
  AND LENGTH(ce.email) > 5
  AND ce.email LIKE '%@%.%'
  AND EXISTS (
    SELECT 1 
    FROM customers_extended ce2 
    WHERE ce2.email = ce.email 
      AND ce2.id != ce.id
      AND ce2.email NOT LIKE '%placeholder%'
      AND ce2.email != '-@gmail.com'
  );

-- ============================================
-- STEP 2: Identify duplicates by VALID phone
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT 
  ce.id as duplicate_id,
  (
    SELECT id 
    FROM customers_extended ce2 
    WHERE ce2.telefono = ce.telefono
      AND ce2.telefono IS NOT NULL 
      AND ce2.telefono != '' 
      AND ce2.telefono NOT LIKE '%placeholder%'
      AND ce2.telefono NOT LIKE '%000000%'
      AND ce2.telefono != '-'
      AND LENGTH(ce2.telefono) >= 8
    ORDER BY 
      (CASE WHEN ce2.nome IS NOT NULL AND ce2.nome != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.cognome IS NOT NULL AND ce2.cognome != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_fiscale IS NOT NULL AND ce2.codice_fiscale != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.email IS NOT NULL AND ce2.email != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND ce2.indirizzo != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.user_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'duplicate_phone' as merge_reason
FROM customers_extended ce
WHERE ce.telefono IS NOT NULL 
  AND ce.telefono != '' 
  AND ce.telefono NOT LIKE '%placeholder%'
  AND ce.telefono NOT LIKE '%000000%'
  AND ce.telefono != '-'
  AND LENGTH(ce.telefono) >= 8
  AND EXISTS (
    SELECT 1 
    FROM customers_extended ce2 
    WHERE ce2.telefono = ce.telefono 
      AND ce2.id != ce.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_merge_map WHERE duplicate_id = ce.id
  );

-- ============================================
-- STEP 3: Identify duplicates by codice_fiscale
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT 
  ce.id as duplicate_id,
  (
    SELECT id 
    FROM customers_extended ce2 
    WHERE ce2.codice_fiscale = ce.codice_fiscale
      AND ce2.codice_fiscale IS NOT NULL 
      AND ce2.codice_fiscale != ''
      AND LENGTH(ce2.codice_fiscale) = 16
    ORDER BY ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'duplicate_codice_fiscale' as merge_reason
FROM customers_extended ce
WHERE ce.codice_fiscale IS NOT NULL 
  AND ce.codice_fiscale != ''
  AND LENGTH(ce.codice_fiscale) = 16
  AND EXISTS (
    SELECT 1 
    FROM customers_extended ce2 
    WHERE ce2.codice_fiscale = ce.codice_fiscale 
      AND ce2.id != ce.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_merge_map WHERE duplicate_id = ce.id
  );

-- ============================================
-- STEP 4: Identify duplicates by partita_iva
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT 
  ce.id as duplicate_id,
  (
    SELECT id 
    FROM customers_extended ce2 
    WHERE ce2.partita_iva = ce.partita_iva
      AND ce2.partita_iva IS NOT NULL 
      AND ce2.partita_iva != ''
      AND LENGTH(ce2.partita_iva) = 11
    ORDER BY ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'duplicate_partita_iva' as merge_reason
FROM customers_extended ce
WHERE ce.partita_iva IS NOT NULL 
  AND ce.partita_iva != ''
  AND LENGTH(ce.partita_iva) = 11
  AND EXISTS (
    SELECT 1 
    FROM customers_extended ce2 
    WHERE ce2.partita_iva = ce.partita_iva 
      AND ce2.id != ce.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_merge_map WHERE duplicate_id = ce.id
  );

-- Remove self-references and NULL primary_ids
DELETE FROM customer_merge_map WHERE duplicate_id = primary_id;
DELETE FROM customer_merge_map WHERE primary_id IS NULL;

-- ============================================
-- MERGE DATA: Fill missing fields in primary records
-- ============================================
UPDATE customers_extended ce_primary
SET 
  nome = COALESCE(ce_primary.nome, ce_dup.nome),
  cognome = COALESCE(ce_primary.cognome, ce_dup.cognome),
  codice_fiscale = COALESCE(ce_primary.codice_fiscale, ce_dup.codice_fiscale),
  patente = COALESCE(ce_primary.patente, ce_dup.patente),
  ragione_sociale = COALESCE(ce_primary.ragione_sociale, ce_dup.ragione_sociale),
  partita_iva = COALESCE(ce_primary.partita_iva, ce_dup.partita_iva),
  codice_destinatario = COALESCE(ce_primary.codice_destinatario, ce_dup.codice_destinatario),
  pec = COALESCE(ce_primary.pec, ce_dup.pec),
  denominazione = COALESCE(ce_primary.denominazione, ce_dup.denominazione),
  codice_ipa = COALESCE(ce_primary.codice_ipa, ce_dup.codice_ipa),
  codice_univoco = COALESCE(ce_primary.codice_univoco, ce_dup.codice_univoco),
  nazione = COALESCE(ce_primary.nazione, ce_dup.nazione),
  email = COALESCE(ce_primary.email, ce_dup.email),
  telefono = COALESCE(ce_primary.telefono, ce_dup.telefono),
  indirizzo = COALESCE(ce_primary.indirizzo, ce_dup.indirizzo),
  user_id = COALESCE(ce_primary.user_id, ce_dup.user_id),
  updated_at = NOW()
FROM customers_extended ce_dup
INNER JOIN customer_merge_map cmm ON ce_dup.id = cmm.duplicate_id
WHERE ce_primary.id = cmm.primary_id;

-- ============================================
-- UPDATE FOREIGN KEYS - ONLY customers_extended references
-- Note: reservations, bookings reference old 'customers' table
-- We only update tables that reference customers_extended
-- ============================================

-- Update commercial_operation_tickets (if it references customers_extended)
UPDATE commercial_operation_tickets
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE commercial_operation_tickets.customer_id = cmm.duplicate_id
  AND EXISTS (
    SELECT 1 FROM customers_extended WHERE id = commercial_operation_tickets.customer_id
  );

-- Update customer_documents (if it references customers_extended)
UPDATE customer_documents
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE customer_documents.customer_id = cmm.duplicate_id
  AND EXISTS (
    SELECT 1 FROM customers_extended WHERE id = customer_documents.customer_id
  );

-- ============================================
-- DELETE DUPLICATES from customers_extended ONLY
-- ============================================
DELETE FROM customers_extended
WHERE id IN (SELECT duplicate_id FROM customer_merge_map);

-- Show results
DO $$
DECLARE
  merge_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO merge_count FROM customer_merge_map;
  RAISE NOTICE '✅ Successfully merged % duplicate customer records in customers_extended', merge_count;
END $$;

-- Clean up
DROP TABLE customer_merge_map;

COMMIT;

-- ============================================
-- ✅ Migration complete!
-- Only merged duplicates in customers_extended table
-- ============================================
