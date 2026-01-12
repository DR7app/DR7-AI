-- ============================================
-- CUSTOMER DUPLICATE MERGE SCRIPT
-- ============================================
-- This script identifies and merges duplicate customer records
-- IMPORTANT: Review the DRY RUN output before executing the actual merge
-- ============================================

-- STEP 1: ANALYZE DUPLICATES (DRY RUN)
-- This shows what will be merged without making changes

DO $$
DECLARE
  duplicate_count INTEGER;
  total_to_merge INTEGER;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'DUPLICATE ANALYSIS - DRY RUN';
  RAISE NOTICE '========================================';
  
  -- Count duplicates by email
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT email
    FROM customers_extended
    WHERE email IS NOT NULL AND email != ''
    GROUP BY email
    HAVING COUNT(*) > 1
  ) AS dups;
  
  RAISE NOTICE 'Duplicate emails found: %', duplicate_count;
  
  -- Count total duplicate records
  SELECT SUM(count - 1) INTO total_to_merge
  FROM (
    SELECT email, COUNT(*) as count
    FROM customers_extended
    WHERE email IS NOT NULL AND email != ''
    GROUP BY email
    HAVING COUNT(*) > 1
  ) AS dups;
  
  RAISE NOTICE 'Total duplicate records to merge: %', total_to_merge;
  RAISE NOTICE '';
END $$;

-- Show top 20 duplicate groups
SELECT 
  email,
  COUNT(*) as duplicate_count,
  STRING_AGG(
    COALESCE(nome || ' ' || cognome, ragione_sociale, 'Unknown') || 
    ' (ID: ' || id::text || ', Source: ' || COALESCE(source, 'unknown') || 
    ', Has CF: ' || CASE WHEN codice_fiscale IS NOT NULL THEN 'Yes' ELSE 'No' END ||
    ', Has Addr: ' || CASE WHEN indirizzo IS NOT NULL THEN 'Yes' ELSE 'No' END || ')',
    E'\n    '
  ) as records
FROM customers_extended
WHERE email IS NOT NULL AND email != ''
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;

-- ============================================
-- STEP 2: CREATE MERGE FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION merge_duplicate_customers()
RETURNS TABLE (
  action TEXT,
  email TEXT,
  master_id UUID,
  merged_ids TEXT,
  details TEXT
) AS $$
DECLARE
  dup_record RECORD;
  master_record RECORD;
  dup_id UUID;
  merged_count INTEGER := 0;
  total_merged INTEGER := 0;
BEGIN
  -- Loop through each duplicate email group
  FOR dup_record IN 
    SELECT e.email, ARRAY_AGG(e.id ORDER BY 
      -- Scoring: prefer records with more data
      (CASE WHEN e.codice_fiscale IS NOT NULL THEN 10 ELSE 0 END +
       CASE WHEN e.indirizzo IS NOT NULL THEN 5 ELSE 0 END +
       CASE WHEN e.data_nascita IS NOT NULL THEN 3 ELSE 0 END +
       CASE WHEN e.telefono IS NOT NULL THEN 2 ELSE 0 END +
       CASE WHEN e.source IN ('website', 'admin') THEN 5 ELSE 0 END) DESC,
      e.updated_at DESC
    ) as customer_ids
    FROM customers_extended e
    WHERE e.email IS NOT NULL AND e.email != ''
    GROUP BY e.email
    HAVING COUNT(*) > 1
  LOOP
    -- First ID in array is the master (most complete record)
    master_record := NULL;
    SELECT * INTO master_record 
    FROM customers_extended 
    WHERE id = dup_record.customer_ids[1];
    
    IF master_record.id IS NULL THEN
      CONTINUE;
    END IF;
    
    merged_count := 0;
    
    -- Loop through duplicate IDs (skip first one as it's the master)
    FOR i IN 2..array_length(dup_record.customer_ids, 1) LOOP
      dup_id := dup_record.customer_ids[i];
      
      -- Update bookings to point to master
      UPDATE bookings 
      SET user_id = master_record.id 
      WHERE user_id = dup_id;
      
      -- Update customer_documents if table exists
      -- Handle unique constraint: (customer_id, document_type)
      BEGIN
        -- First, delete duplicate documents that would conflict with master's documents
        DELETE FROM customer_documents
        WHERE customer_id = dup_id
        AND document_type IN (
          SELECT document_type 
          FROM customer_documents 
          WHERE customer_id = master_record.id
        );
        
        -- Now update remaining documents to point to master
        UPDATE customer_documents 
        SET customer_id = master_record.id 
        WHERE customer_id = dup_id;
      EXCEPTION WHEN undefined_table THEN
        -- Table doesn't exist, skip
        NULL;
      END;
      
      -- Update customer_memberships if table exists
      BEGIN
        UPDATE customer_memberships 
        SET client_id = master_record.id 
        WHERE client_id = dup_id;
      EXCEPTION WHEN undefined_table THEN
        -- Table doesn't exist, skip
        NULL;
      END;
      
      -- Merge any missing data from duplicate to master
      UPDATE customers_extended
      SET
        telefono = COALESCE(customers_extended.telefono, dup.telefono),
        codice_fiscale = COALESCE(customers_extended.codice_fiscale, dup.codice_fiscale),
        indirizzo = COALESCE(customers_extended.indirizzo, dup.indirizzo),
        numero_civico = COALESCE(customers_extended.numero_civico, dup.numero_civico),
        cap = COALESCE(customers_extended.cap, dup.cap),
        citta = COALESCE(customers_extended.citta, dup.citta),
        provincia = COALESCE(customers_extended.provincia, dup.provincia),
        data_nascita = COALESCE(customers_extended.data_nascita, dup.data_nascita),
        luogo_nascita = COALESCE(customers_extended.luogo_nascita, dup.luogo_nascita),
        numero_patente = COALESCE(customers_extended.numero_patente, dup.numero_patente),
        scadenza_patente = COALESCE(customers_extended.scadenza_patente, dup.scadenza_patente),
        updated_at = NOW()
      FROM (SELECT * FROM customers_extended WHERE id = dup_id) AS dup
      WHERE customers_extended.id = master_record.id;
      
      -- Delete the duplicate record
      DELETE FROM customers_extended WHERE id = dup_id;
      
      merged_count := merged_count + 1;
      total_merged := total_merged + 1;
    END LOOP;
    
    -- Return result for this merge
    RETURN QUERY SELECT 
      'MERGED'::TEXT,
      dup_record.email,
      master_record.id,
      array_to_string(dup_record.customer_ids[2:array_length(dup_record.customer_ids, 1)], ', '),
      format('Merged %s duplicate(s) into master record', merged_count);
  END LOOP;
  
  -- Final summary
  RETURN QUERY SELECT 
    'SUMMARY'::TEXT,
    NULL::TEXT,
    NULL::UUID,
    NULL::TEXT,
    format('Total duplicates merged: %s', total_merged);
    
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 3: EXECUTE MERGE (UNCOMMENT TO RUN)
-- ============================================
-- WARNING: This will permanently merge duplicate records
-- Review the dry run output above before uncommenting

SELECT * FROM merge_duplicate_customers();

-- ============================================
-- STEP 4: VERIFY RESULTS
-- ============================================
-- Run this after merge to confirm no duplicates remain

-- SELECT 
--   email,
--   COUNT(*) as count
-- FROM customers_extended
-- WHERE email IS NOT NULL AND email != ''
-- GROUP BY email
-- HAVING COUNT(*) > 1;

-- Should return 0 rows if merge was successful
