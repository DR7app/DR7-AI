-- ============================================
-- MERGE DUPLICATE CUSTOMERS - CASE INSENSITIVE
-- Handles email/phone variations with different cases
-- ============================================

BEGIN;

CREATE TEMP TABLE customer_merge_map (
  duplicate_id UUID,
  primary_id UUID,
  merge_reason TEXT
);

-- ============================================
-- STEP 1: Identify duplicates by email (CASE INSENSITIVE)
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT 
  ce.id as duplicate_id,
  (
    SELECT id 
    FROM customers_extended ce2 
    WHERE LOWER(ce2.email) = LOWER(ce.email)
      AND ce2.email IS NOT NULL 
      AND ce2.email != '' 
      AND ce2.email NOT ILIKE '%placeholder%'
      AND ce2.email NOT ILIKE '%noemail%'
      AND ce2.email NOT ILIKE '%@example.com%'
      AND LOWER(ce2.email) != '-@gmail.com'
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
  AND ce.email NOT ILIKE '%placeholder%'
  AND ce.email NOT ILIKE '%noemail%'
  AND ce.email NOT ILIKE '%@example.com%'
  AND LOWER(ce.email) != '-@gmail.com'
  AND ce.email NOT LIKE '-%'
  AND LENGTH(ce.email) > 5
  AND ce.email LIKE '%@%.%'
  AND EXISTS (
    SELECT 1 
    FROM customers_extended ce2 
    WHERE LOWER(ce2.email) = LOWER(ce.email)
      AND ce2.id != ce.id
  );

-- ============================================
-- STEP 2: Identify duplicates by phone
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
-- STEP 3: Identify duplicates by codice_fiscale (CASE INSENSITIVE)
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT 
  ce.id as duplicate_id,
  (
    SELECT id 
    FROM customers_extended ce2 
    WHERE UPPER(ce2.codice_fiscale) = UPPER(ce.codice_fiscale)
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
    WHERE UPPER(ce2.codice_fiscale) = UPPER(ce.codice_fiscale)
      AND ce2.id != ce.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_merge_map WHERE duplicate_id = ce.id
  );

-- Remove self-references and NULL primary_ids
DELETE FROM customer_merge_map WHERE duplicate_id = primary_id;
DELETE FROM customer_merge_map WHERE primary_id IS NULL;

-- ============================================
-- MERGE DATA
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
-- UPDATE FOREIGN KEYS
-- ============================================
UPDATE commercial_operation_tickets
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE commercial_operation_tickets.customer_id = cmm.duplicate_id;

UPDATE customer_documents
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE customer_documents.customer_id = cmm.duplicate_id;

-- ============================================
-- DELETE DUPLICATES
-- ============================================
DELETE FROM customers_extended
WHERE id IN (SELECT duplicate_id FROM customer_merge_map);

-- Show results
DO $$
DECLARE
  merge_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO merge_count FROM customer_merge_map;
  RAISE NOTICE '✅ Merged % duplicate customers', merge_count;
END $$;

DROP TABLE customer_merge_map;

COMMIT;
