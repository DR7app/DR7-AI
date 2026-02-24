-- ============================================
-- MERGE DUPLICATE CUSTOMERS v3 — PREVIEW ONLY
-- Run this FIRST to see what will be merged
-- Does NOT modify any data
-- ============================================

CREATE TEMP TABLE customer_merge_preview (
  duplicate_id UUID,
  primary_id UUID,
  merge_reason TEXT
);

-- STEP 1: Duplicates by CODICE FISCALE
INSERT INTO customer_merge_preview (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id as duplicate_id,
  (
    SELECT id FROM customers_extended ce2
    WHERE UPPER(TRIM(ce2.codice_fiscale)) = UPPER(TRIM(ce.codice_fiscale))
      AND ce2.codice_fiscale IS NOT NULL
      AND TRIM(ce2.codice_fiscale) != ''
      AND LENGTH(TRIM(ce2.codice_fiscale)) >= 11
    ORDER BY
      (CASE WHEN ce2.user_id IS NOT NULL THEN 10 ELSE 0 END +
       CASE WHEN ce2.nome IS NOT NULL AND TRIM(ce2.nome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.cognome IS NOT NULL AND TRIM(ce2.cognome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.email IS NOT NULL AND TRIM(ce2.email) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.telefono IS NOT NULL AND TRIM(ce2.telefono) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND TRIM(ce2.indirizzo) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.patente IS NOT NULL AND TRIM(ce2.patente) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.numero_patente IS NOT NULL AND TRIM(ce2.numero_patente) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.data_nascita IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_postale IS NOT NULL AND TRIM(ce2.codice_postale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.citta_residenza IS NOT NULL AND TRIM(ce2.citta_residenza) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.pec IS NOT NULL AND TRIM(ce2.pec) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.partita_iva IS NOT NULL AND TRIM(ce2.partita_iva) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.ragione_sociale IS NOT NULL AND TRIM(ce2.ragione_sociale) != '' THEN 1 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'codice_fiscale' as merge_reason
FROM customers_extended ce
WHERE ce.codice_fiscale IS NOT NULL
  AND TRIM(ce.codice_fiscale) != ''
  AND LENGTH(TRIM(ce.codice_fiscale)) >= 11
  AND EXISTS (
    SELECT 1 FROM customers_extended ce2
    WHERE UPPER(TRIM(ce2.codice_fiscale)) = UPPER(TRIM(ce.codice_fiscale))
      AND ce2.id != ce.id
  );

-- STEP 2: Duplicates by PARTITA IVA
INSERT INTO customer_merge_preview (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id,
  (
    SELECT id FROM customers_extended ce2
    WHERE TRIM(ce2.partita_iva) = TRIM(ce.partita_iva)
      AND ce2.partita_iva IS NOT NULL AND TRIM(ce2.partita_iva) != ''
      AND LENGTH(TRIM(ce2.partita_iva)) >= 11
    ORDER BY
      (CASE WHEN ce2.user_id IS NOT NULL THEN 10 ELSE 0 END +
       CASE WHEN ce2.ragione_sociale IS NOT NULL AND TRIM(ce2.ragione_sociale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.denominazione IS NOT NULL AND TRIM(ce2.denominazione) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.email IS NOT NULL AND TRIM(ce2.email) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.telefono IS NOT NULL AND TRIM(ce2.telefono) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_destinatario IS NOT NULL AND TRIM(ce2.codice_destinatario) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.pec IS NOT NULL AND TRIM(ce2.pec) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.sede_legale IS NOT NULL AND TRIM(ce2.sede_legale) != '' THEN 1 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ),
  'partita_iva'
FROM customers_extended ce
WHERE ce.partita_iva IS NOT NULL AND TRIM(ce.partita_iva) != ''
  AND LENGTH(TRIM(ce.partita_iva)) >= 11
  AND EXISTS (
    SELECT 1 FROM customers_extended ce2
    WHERE TRIM(ce2.partita_iva) = TRIM(ce.partita_iva) AND ce2.id != ce.id
  )
  AND NOT EXISTS (SELECT 1 FROM customer_merge_preview WHERE duplicate_id = ce.id);

-- STEP 3: Duplicates by EMAIL
INSERT INTO customer_merge_preview (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id,
  (
    SELECT id FROM customers_extended ce2
    WHERE LOWER(TRIM(ce2.email)) = LOWER(TRIM(ce.email))
      AND ce2.email IS NOT NULL AND TRIM(ce2.email) != ''
      AND ce2.email NOT ILIKE '%placeholder%'
      AND ce2.email NOT ILIKE '%noemail%'
      AND ce2.email NOT ILIKE '%@example.com%'
      AND LOWER(TRIM(ce2.email)) != '-@gmail.com'
      AND ce2.email NOT LIKE '-%'
      AND LENGTH(TRIM(ce2.email)) > 5
      AND ce2.email LIKE '%@%.%'
    ORDER BY
      (CASE WHEN ce2.user_id IS NOT NULL THEN 10 ELSE 0 END +
       CASE WHEN ce2.nome IS NOT NULL AND TRIM(ce2.nome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.cognome IS NOT NULL AND TRIM(ce2.cognome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_fiscale IS NOT NULL AND TRIM(ce2.codice_fiscale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.telefono IS NOT NULL AND TRIM(ce2.telefono) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND TRIM(ce2.indirizzo) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.patente IS NOT NULL AND TRIM(ce2.patente) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.partita_iva IS NOT NULL AND TRIM(ce2.partita_iva) != '' THEN 1 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ),
  'email'
FROM customers_extended ce
WHERE ce.email IS NOT NULL AND TRIM(ce.email) != ''
  AND ce.email NOT ILIKE '%placeholder%'
  AND ce.email NOT ILIKE '%noemail%'
  AND ce.email NOT ILIKE '%@example.com%'
  AND LOWER(TRIM(ce.email)) != '-@gmail.com'
  AND ce.email NOT LIKE '-%'
  AND LENGTH(TRIM(ce.email)) > 5
  AND ce.email LIKE '%@%.%'
  AND EXISTS (
    SELECT 1 FROM customers_extended ce2
    WHERE LOWER(TRIM(ce2.email)) = LOWER(TRIM(ce.email)) AND ce2.id != ce.id
  )
  AND NOT EXISTS (SELECT 1 FROM customer_merge_preview WHERE duplicate_id = ce.id);

-- STEP 4: Duplicates by PHONE
INSERT INTO customer_merge_preview (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id,
  (
    SELECT id FROM customers_extended ce2
    WHERE TRIM(ce2.telefono) = TRIM(ce.telefono)
      AND ce2.telefono IS NOT NULL AND TRIM(ce2.telefono) != ''
      AND ce2.telefono NOT LIKE '%placeholder%'
      AND ce2.telefono NOT LIKE '%000000%'
      AND TRIM(ce2.telefono) != '-'
      AND LENGTH(TRIM(ce2.telefono)) >= 8
    ORDER BY
      (CASE WHEN ce2.user_id IS NOT NULL THEN 10 ELSE 0 END +
       CASE WHEN ce2.nome IS NOT NULL AND TRIM(ce2.nome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.cognome IS NOT NULL AND TRIM(ce2.cognome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.email IS NOT NULL AND TRIM(ce2.email) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_fiscale IS NOT NULL AND TRIM(ce2.codice_fiscale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND TRIM(ce2.indirizzo) != '' THEN 1 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ),
  'telefono'
FROM customers_extended ce
WHERE ce.telefono IS NOT NULL AND TRIM(ce.telefono) != ''
  AND ce.telefono NOT LIKE '%placeholder%'
  AND ce.telefono NOT LIKE '%000000%'
  AND TRIM(ce.telefono) != '-'
  AND LENGTH(TRIM(ce.telefono)) >= 8
  AND EXISTS (
    SELECT 1 FROM customers_extended ce2
    WHERE TRIM(ce2.telefono) = TRIM(ce.telefono) AND ce2.id != ce.id
  )
  AND NOT EXISTS (SELECT 1 FROM customer_merge_preview WHERE duplicate_id = ce.id);

-- STEP 5: Duplicates by EXACT NAME (nome + cognome, case insensitive)
INSERT INTO customer_merge_preview (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id,
  (
    SELECT id FROM customers_extended ce2
    WHERE LOWER(TRIM(ce2.nome)) = LOWER(TRIM(ce.nome))
      AND LOWER(TRIM(ce2.cognome)) = LOWER(TRIM(ce.cognome))
      AND ce2.nome IS NOT NULL AND TRIM(ce2.nome) != ''
      AND ce2.cognome IS NOT NULL AND TRIM(ce2.cognome) != ''
      AND LENGTH(TRIM(ce2.nome)) >= 2
      AND LENGTH(TRIM(ce2.cognome)) >= 2
    ORDER BY
      (CASE WHEN ce2.user_id IS NOT NULL THEN 10 ELSE 0 END +
       CASE WHEN ce2.email IS NOT NULL AND TRIM(ce2.email) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.telefono IS NOT NULL AND TRIM(ce2.telefono) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_fiscale IS NOT NULL AND TRIM(ce2.codice_fiscale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND TRIM(ce2.indirizzo) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.patente IS NOT NULL AND TRIM(ce2.patente) != '' THEN 1 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ),
  'nome_cognome'
FROM customers_extended ce
WHERE ce.nome IS NOT NULL AND TRIM(ce.nome) != ''
  AND ce.cognome IS NOT NULL AND TRIM(ce.cognome) != ''
  AND LENGTH(TRIM(ce.nome)) >= 2
  AND LENGTH(TRIM(ce.cognome)) >= 2
  AND EXISTS (
    SELECT 1 FROM customers_extended ce2
    WHERE LOWER(TRIM(ce2.nome)) = LOWER(TRIM(ce.nome))
      AND LOWER(TRIM(ce2.cognome)) = LOWER(TRIM(ce.cognome))
      AND ce2.id != ce.id
  )
  AND NOT EXISTS (SELECT 1 FROM customer_merge_preview WHERE duplicate_id = ce.id);

-- Cleanup: remove self-references
DELETE FROM customer_merge_preview WHERE duplicate_id = primary_id;
DELETE FROM customer_merge_preview WHERE primary_id IS NULL;

-- ============================================
-- RESULTS: Review this carefully before running the execute script
-- ============================================

-- Summary by reason
SELECT merge_reason, COUNT(*) as count
FROM customer_merge_preview
GROUP BY merge_reason
ORDER BY count DESC;

-- Total duplicates
SELECT COUNT(*) as total_duplicates_to_merge FROM customer_merge_preview;

-- Detailed list: who gets merged into whom
SELECT
  cmm.merge_reason,
  dup.nome as dup_nome,
  dup.cognome as dup_cognome,
  dup.email as dup_email,
  dup.telefono as dup_telefono,
  dup.codice_fiscale as dup_cf,
  '  →  ' as merges_into,
  pri.nome as pri_nome,
  pri.cognome as pri_cognome,
  pri.email as pri_email,
  pri.telefono as pri_telefono,
  pri.codice_fiscale as pri_cf,
  CASE WHEN pri.user_id IS NOT NULL THEN 'YES' ELSE 'no' END as pri_has_account
FROM customer_merge_preview cmm
JOIN customers_extended dup ON dup.id = cmm.duplicate_id
JOIN customers_extended pri ON pri.id = cmm.primary_id
ORDER BY cmm.merge_reason, pri.cognome, pri.nome;

-- Show bookings that will be reassigned
SELECT
  cmm.merge_reason,
  b.id as booking_id,
  b.customer_name,
  b.pickup_date,
  'from ' || cmm.duplicate_id || ' → ' || cmm.primary_id as reassignment
FROM customer_merge_preview cmm
JOIN bookings b ON b.customer_id = cmm.duplicate_id
ORDER BY cmm.merge_reason, b.pickup_date DESC;

DROP TABLE customer_merge_preview;
