-- ============================================
-- MERGE DUPLICATE CUSTOMERS v2
-- Keeps the record with the most filled fields
-- Updates ALL foreign keys (including bookings)
-- ============================================

BEGIN;

CREATE TEMP TABLE customer_merge_map (
  duplicate_id UUID,
  primary_id UUID,
  merge_reason TEXT
);

-- Helper: count non-null, non-empty fields to determine "most complete" record
-- Used in ORDER BY to pick the primary (best) record

-- ============================================
-- STEP 1: Merge by CODICE FISCALE (strongest identifier)
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id as duplicate_id,
  (
    SELECT id
    FROM customers_extended ce2
    WHERE UPPER(TRIM(ce2.codice_fiscale)) = UPPER(TRIM(ce.codice_fiscale))
      AND ce2.codice_fiscale IS NOT NULL
      AND TRIM(ce2.codice_fiscale) != ''
      AND LENGTH(TRIM(ce2.codice_fiscale)) >= 11
    ORDER BY
      (CASE WHEN ce2.nome IS NOT NULL AND TRIM(ce2.nome) != '' THEN 1 ELSE 0 END +
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
       CASE WHEN ce2.ragione_sociale IS NOT NULL AND TRIM(ce2.ragione_sociale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.partita_iva IS NOT NULL AND TRIM(ce2.partita_iva) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.user_id IS NOT NULL THEN 2 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'duplicate_codice_fiscale' as merge_reason
FROM customers_extended ce
WHERE ce.codice_fiscale IS NOT NULL
  AND TRIM(ce.codice_fiscale) != ''
  AND LENGTH(TRIM(ce.codice_fiscale)) >= 11
  AND EXISTS (
    SELECT 1
    FROM customers_extended ce2
    WHERE UPPER(TRIM(ce2.codice_fiscale)) = UPPER(TRIM(ce.codice_fiscale))
      AND ce2.id != ce.id
  );

-- ============================================
-- STEP 2: Merge by PARTITA IVA (azienda)
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id as duplicate_id,
  (
    SELECT id
    FROM customers_extended ce2
    WHERE TRIM(ce2.partita_iva) = TRIM(ce.partita_iva)
      AND ce2.partita_iva IS NOT NULL
      AND TRIM(ce2.partita_iva) != ''
      AND LENGTH(TRIM(ce2.partita_iva)) >= 11
    ORDER BY
      (CASE WHEN ce2.ragione_sociale IS NOT NULL AND TRIM(ce2.ragione_sociale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.denominazione IS NOT NULL AND TRIM(ce2.denominazione) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.email IS NOT NULL AND TRIM(ce2.email) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.telefono IS NOT NULL AND TRIM(ce2.telefono) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_destinatario IS NOT NULL AND TRIM(ce2.codice_destinatario) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.pec IS NOT NULL AND TRIM(ce2.pec) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.sede_legale IS NOT NULL AND TRIM(ce2.sede_legale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.user_id IS NOT NULL THEN 2 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'duplicate_partita_iva' as merge_reason
FROM customers_extended ce
WHERE ce.partita_iva IS NOT NULL
  AND TRIM(ce.partita_iva) != ''
  AND LENGTH(TRIM(ce.partita_iva)) >= 11
  AND EXISTS (
    SELECT 1
    FROM customers_extended ce2
    WHERE TRIM(ce2.partita_iva) = TRIM(ce.partita_iva)
      AND ce2.id != ce.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_merge_map WHERE duplicate_id = ce.id
  );

-- ============================================
-- STEP 3: Merge by EMAIL (case insensitive)
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id as duplicate_id,
  (
    SELECT id
    FROM customers_extended ce2
    WHERE LOWER(TRIM(ce2.email)) = LOWER(TRIM(ce.email))
      AND ce2.email IS NOT NULL
      AND TRIM(ce2.email) != ''
      AND ce2.email NOT ILIKE '%placeholder%'
      AND ce2.email NOT ILIKE '%noemail%'
      AND ce2.email NOT ILIKE '%@example.com%'
      AND LOWER(TRIM(ce2.email)) != '-@gmail.com'
      AND ce2.email NOT LIKE '-%'
      AND LENGTH(TRIM(ce2.email)) > 5
      AND ce2.email LIKE '%@%.%'
    ORDER BY
      (CASE WHEN ce2.nome IS NOT NULL AND TRIM(ce2.nome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.cognome IS NOT NULL AND TRIM(ce2.cognome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_fiscale IS NOT NULL AND TRIM(ce2.codice_fiscale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.telefono IS NOT NULL AND TRIM(ce2.telefono) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND TRIM(ce2.indirizzo) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.patente IS NOT NULL AND TRIM(ce2.patente) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.ragione_sociale IS NOT NULL AND TRIM(ce2.ragione_sociale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.partita_iva IS NOT NULL AND TRIM(ce2.partita_iva) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.user_id IS NOT NULL THEN 2 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'duplicate_email' as merge_reason
FROM customers_extended ce
WHERE ce.email IS NOT NULL
  AND TRIM(ce.email) != ''
  AND ce.email NOT ILIKE '%placeholder%'
  AND ce.email NOT ILIKE '%noemail%'
  AND ce.email NOT ILIKE '%@example.com%'
  AND LOWER(TRIM(ce.email)) != '-@gmail.com'
  AND ce.email NOT LIKE '-%'
  AND LENGTH(TRIM(ce.email)) > 5
  AND ce.email LIKE '%@%.%'
  AND EXISTS (
    SELECT 1
    FROM customers_extended ce2
    WHERE LOWER(TRIM(ce2.email)) = LOWER(TRIM(ce.email))
      AND ce2.id != ce.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_merge_map WHERE duplicate_id = ce.id
  );

-- ============================================
-- STEP 4: Merge by PHONE
-- ============================================
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT
  ce.id as duplicate_id,
  (
    SELECT id
    FROM customers_extended ce2
    WHERE TRIM(ce2.telefono) = TRIM(ce.telefono)
      AND ce2.telefono IS NOT NULL
      AND TRIM(ce2.telefono) != ''
      AND ce2.telefono NOT LIKE '%placeholder%'
      AND ce2.telefono NOT LIKE '%000000%'
      AND TRIM(ce2.telefono) != '-'
      AND LENGTH(TRIM(ce2.telefono)) >= 8
    ORDER BY
      (CASE WHEN ce2.nome IS NOT NULL AND TRIM(ce2.nome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.cognome IS NOT NULL AND TRIM(ce2.cognome) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.email IS NOT NULL AND TRIM(ce2.email) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_fiscale IS NOT NULL AND TRIM(ce2.codice_fiscale) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND TRIM(ce2.indirizzo) != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.user_id IS NOT NULL THEN 2 ELSE 0 END) DESC,
      ce2.created_at ASC
    LIMIT 1
  ) as primary_id,
  'duplicate_phone' as merge_reason
FROM customers_extended ce
WHERE ce.telefono IS NOT NULL
  AND TRIM(ce.telefono) != ''
  AND ce.telefono NOT LIKE '%placeholder%'
  AND ce.telefono NOT LIKE '%000000%'
  AND TRIM(ce.telefono) != '-'
  AND LENGTH(TRIM(ce.telefono)) >= 8
  AND EXISTS (
    SELECT 1
    FROM customers_extended ce2
    WHERE TRIM(ce2.telefono) = TRIM(ce.telefono)
      AND ce2.id != ce.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_merge_map WHERE duplicate_id = ce.id
  );

-- ============================================
-- CLEANUP: Remove self-references and NULL primary_ids
-- ============================================
DELETE FROM customer_merge_map WHERE duplicate_id = primary_id;
DELETE FROM customer_merge_map WHERE primary_id IS NULL;

-- ============================================
-- DRY RUN: Show what will be merged before executing
-- ============================================
SELECT
  cmm.merge_reason,
  cmm.duplicate_id,
  cmm.primary_id,
  dup.nome as dup_nome,
  dup.cognome as dup_cognome,
  dup.email as dup_email,
  dup.telefono as dup_telefono,
  pri.nome as pri_nome,
  pri.cognome as pri_cognome,
  pri.email as pri_email,
  pri.telefono as pri_telefono
FROM customer_merge_map cmm
JOIN customers_extended dup ON dup.id = cmm.duplicate_id
JOIN customers_extended pri ON pri.id = cmm.primary_id
ORDER BY cmm.merge_reason, pri.cognome;

-- Count
SELECT merge_reason, COUNT(*) as count
FROM customer_merge_map
GROUP BY merge_reason
ORDER BY count DESC;

SELECT COUNT(*) as total_duplicates_to_merge FROM customer_merge_map;

-- ============================================
-- MERGE DATA: Fill missing fields from duplicate into primary
-- ============================================
UPDATE customers_extended ce_primary
SET
  nome = COALESCE(NULLIF(TRIM(ce_primary.nome), ''), ce_dup.nome),
  cognome = COALESCE(NULLIF(TRIM(ce_primary.cognome), ''), ce_dup.cognome),
  codice_fiscale = COALESCE(NULLIF(TRIM(ce_primary.codice_fiscale), ''), ce_dup.codice_fiscale),
  patente = COALESCE(NULLIF(TRIM(ce_primary.patente), ''), ce_dup.patente),
  numero_patente = COALESCE(NULLIF(TRIM(ce_primary.numero_patente), ''), ce_dup.numero_patente),
  tipo_patente = COALESCE(NULLIF(TRIM(ce_primary.tipo_patente), ''), ce_dup.tipo_patente),
  emessa_da = COALESCE(NULLIF(TRIM(ce_primary.emessa_da), ''), ce_dup.emessa_da),
  data_rilascio_patente = COALESCE(ce_primary.data_rilascio_patente, ce_dup.data_rilascio_patente),
  scadenza_patente = COALESCE(ce_primary.scadenza_patente, ce_dup.scadenza_patente),
  ragione_sociale = COALESCE(NULLIF(TRIM(ce_primary.ragione_sociale), ''), ce_dup.ragione_sociale),
  denominazione = COALESCE(NULLIF(TRIM(ce_primary.denominazione), ''), ce_dup.denominazione),
  partita_iva = COALESCE(NULLIF(TRIM(ce_primary.partita_iva), ''), ce_dup.partita_iva),
  codice_destinatario = COALESCE(NULLIF(TRIM(ce_primary.codice_destinatario), ''), ce_dup.codice_destinatario),
  pec = COALESCE(NULLIF(TRIM(ce_primary.pec), ''), ce_dup.pec),
  codice_ipa = COALESCE(NULLIF(TRIM(ce_primary.codice_ipa), ''), ce_dup.codice_ipa),
  codice_univoco = COALESCE(NULLIF(TRIM(ce_primary.codice_univoco), ''), ce_dup.codice_univoco),
  ente_ufficio = COALESCE(NULLIF(TRIM(ce_primary.ente_ufficio), ''), ce_dup.ente_ufficio),
  nazione = COALESCE(NULLIF(TRIM(ce_primary.nazione), ''), ce_dup.nazione),
  email = COALESCE(NULLIF(TRIM(ce_primary.email), ''), ce_dup.email),
  telefono = COALESCE(NULLIF(TRIM(ce_primary.telefono), ''), ce_dup.telefono),
  indirizzo = COALESCE(NULLIF(TRIM(ce_primary.indirizzo), ''), ce_dup.indirizzo),
  citta_residenza = COALESCE(NULLIF(TRIM(ce_primary.citta_residenza), ''), ce_dup.citta_residenza),
  provincia_residenza = COALESCE(NULLIF(TRIM(ce_primary.provincia_residenza), ''), ce_dup.provincia_residenza),
  codice_postale = COALESCE(NULLIF(TRIM(ce_primary.codice_postale), ''), ce_dup.codice_postale),
  numero_civico = COALESCE(NULLIF(TRIM(ce_primary.numero_civico), ''), ce_dup.numero_civico),
  data_nascita = COALESCE(ce_primary.data_nascita, ce_dup.data_nascita),
  luogo_nascita = COALESCE(NULLIF(TRIM(ce_primary.luogo_nascita), ''), ce_dup.luogo_nascita),
  sesso = COALESCE(NULLIF(TRIM(ce_primary.sesso), ''), ce_dup.sesso),
  sede_legale = COALESCE(NULLIF(TRIM(ce_primary.sede_legale), ''), ce_dup.sede_legale),
  sede_operativa = COALESCE(NULLIF(TRIM(ce_primary.sede_operativa), ''), ce_dup.sede_operativa),
  user_id = COALESCE(ce_primary.user_id, ce_dup.user_id),
  updated_at = NOW()
FROM customers_extended ce_dup
INNER JOIN customer_merge_map cmm ON ce_dup.id = cmm.duplicate_id
WHERE ce_primary.id = cmm.primary_id;

-- ============================================
-- UPDATE ALL FOREIGN KEYS
-- ============================================

-- Bookings: customer_id
UPDATE bookings
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE bookings.customer_id = cmm.duplicate_id;

-- Bookings: second_driver_id (stored in booking_details jsonb)
-- Note: second_driver_id is referenced in code but may be in booking_details

-- Commercial operation tickets
UPDATE commercial_operation_tickets
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE commercial_operation_tickets.customer_id = cmm.duplicate_id;

-- Customer documents
UPDATE customer_documents
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE customer_documents.customer_id = cmm.duplicate_id;

-- Birthday messages
UPDATE birthday_messages
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE birthday_messages.customer_id = cmm.duplicate_id;

-- Birthday discount codes
UPDATE birthday_discount_codes
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE birthday_discount_codes.customer_id = cmm.duplicate_id;

-- Birthday vouchers
UPDATE birthday_vouchers
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE birthday_vouchers.customer_id = cmm.duplicate_id;

-- Review WhatsApp sent
UPDATE review_whatsapp_sent
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE review_whatsapp_sent.customer_id = cmm.duplicate_id;

-- ============================================
-- DELETE DUPLICATES
-- ============================================
DELETE FROM customers_extended
WHERE id IN (SELECT duplicate_id FROM customer_merge_map);

-- ============================================
-- RESULTS
-- ============================================
DO $$
DECLARE
  merge_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO merge_count FROM customer_merge_map;
  RAISE NOTICE '✅ Merged and deleted % duplicate customers', merge_count;
END $$;

DROP TABLE customer_merge_map;

COMMIT;
