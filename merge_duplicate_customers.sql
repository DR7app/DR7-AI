-- ============================================
-- SMART MERGE DUPLICATE CUSTOMERS IN customers_extended
-- ============================================
-- This script will:
-- 1. Identify REAL duplicates (same person with multiple records)
-- 2. EXCLUDE placeholder/invalid emails and phones from merge logic
-- 3. Keep the oldest record (by created_at) as the primary
-- 4. Update all foreign key references to point to the primary
-- 5. Merge data from duplicates into primary (fill in missing fields)
-- 6. Delete duplicate records
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
-- ============================================
-- Only merge if email is valid and not a placeholder
-- Keep the MOST COMPLETE record as primary (most non-null fields)
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
      AND ce2.email != '-@gmail.com'  -- Exclude invalid placeholder
      AND ce2.email NOT LIKE '-%'      -- Exclude emails starting with -
      AND LENGTH(ce2.email) > 5        -- Must be a real email
      AND ce2.email LIKE '%@%.%'       -- Must have @ and domain
    ORDER BY 
      -- Count non-null fields to find most complete record
      (CASE WHEN ce2.nome IS NOT NULL AND ce2.nome != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.cognome IS NOT NULL AND ce2.cognome != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.codice_fiscale IS NOT NULL AND ce2.codice_fiscale != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.patente IS NOT NULL AND ce2.patente != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.telefono IS NOT NULL AND ce2.telefono != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.indirizzo IS NOT NULL AND ce2.indirizzo != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.ragione_sociale IS NOT NULL AND ce2.ragione_sociale != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.partita_iva IS NOT NULL AND ce2.partita_iva != '' THEN 1 ELSE 0 END +
       CASE WHEN ce2.user_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
      ce2.created_at ASC  -- If equal completeness, prefer older record
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
-- Only merge if phone is valid and not a placeholder
-- Keep the MOST COMPLETE record as primary
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
      AND LENGTH(ce2.telefono) >= 8  -- Real phone numbers are at least 8 digits
    ORDER BY 
      -- Count non-null fields to find most complete record
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
-- Codice Fiscale is unique per person, safe to merge
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT 
  ce.id as duplicate_id,
  (
    SELECT id 
    FROM customers_extended ce2 
    WHERE ce2.codice_fiscale = ce.codice_fiscale
      AND ce2.codice_fiscale IS NOT NULL 
      AND ce2.codice_fiscale != ''
      AND LENGTH(ce2.codice_fiscale) = 16  -- Italian CF is exactly 16 chars
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
-- Partita IVA is unique per company, safe to merge
INSERT INTO customer_merge_map (duplicate_id, primary_id, merge_reason)
SELECT 
  ce.id as duplicate_id,
  (
    SELECT id 
    FROM customers_extended ce2 
    WHERE ce2.partita_iva = ce.partita_iva
      AND ce2.partita_iva IS NOT NULL 
      AND ce2.partita_iva != ''
      AND LENGTH(ce2.partita_iva) = 11  -- Italian P.IVA is exactly 11 digits
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

-- Remove self-references (where duplicate_id = primary_id)
DELETE FROM customer_merge_map WHERE duplicate_id = primary_id;

-- Remove NULL primary_ids
DELETE FROM customer_merge_map WHERE primary_id IS NULL;

-- Show what will be merged
SELECT 
  cmm.merge_reason,
  COUNT(*) as duplicates_to_merge,
  COUNT(DISTINCT cmm.primary_id) as unique_primary_records
FROM customer_merge_map cmm
GROUP BY cmm.merge_reason;

-- ============================================
-- STEP 5: Merge data from duplicates into primary records
-- ============================================
-- Update primary records with missing data from duplicates
UPDATE customers_extended ce_primary
SET 
  -- Fill in missing fields from duplicates
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
-- STEP 6: Update foreign key references
-- ============================================

-- Update reservations table
UPDATE reservations
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE reservations.customer_id = cmm.duplicate_id;

-- Note: fatture table stores customer data directly (customer_name, customer_email, etc.)
-- and doesn't have a customer_id foreign key, so no update needed

-- Update bookings table (includes car wash, mechanical, and other booking types)
UPDATE bookings
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE bookings.customer_id = cmm.duplicate_id;

-- Update commercial_operation_tickets table
UPDATE commercial_operation_tickets
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE commercial_operation_tickets.customer_id = cmm.duplicate_id;

-- Update customer_documents table
UPDATE customer_documents
SET customer_id = cmm.primary_id
FROM customer_merge_map cmm
WHERE customer_documents.customer_id = cmm.duplicate_id;

-- ============================================
-- STEP 7: Delete duplicate records
-- ============================================
DELETE FROM customers_extended
WHERE id IN (SELECT duplicate_id FROM customer_merge_map);

-- ============================================
-- STEP 8: Show results
-- ============================================
SELECT 
  'Total duplicates merged' as result,
  COUNT(*) as count
FROM customer_merge_map;

-- Clean up
DROP TABLE customer_merge_map;

COMMIT;

-- ============================================
-- ✅ Smart duplicate merge complete!
-- Only merged REAL duplicates, excluded placeholder emails/phones
-- ============================================
