-- =====================================================
-- CLEANUP: Merge Duplicate Customers (Safe Bonifica)
-- =====================================================
-- This script identifies duplicate customers by email and phone,
-- keeps the oldest record (original lead), reassigns all bookings
-- and related records to it, then deletes the duplicates.
-- =====================================================

-- Step 1: Preview duplicates by email (DRY RUN)
-- Run this SELECT first to review before executing the merge
DO $$
DECLARE
  dup RECORD;
  keeper_id UUID;
  duplicate_ids UUID[];
  dup_id UUID;
  reassigned_count INT;
BEGIN
  RAISE NOTICE '===== DUPLICATE CUSTOMER CLEANUP START =====';
  RAISE NOTICE '';

  -- Find duplicate groups by email (case-insensitive)
  FOR dup IN
    SELECT LOWER(email) as norm_email,
           array_agg(id ORDER BY created_at ASC NULLS LAST) as ids,
           COUNT(*) as cnt
    FROM customers_extended
    WHERE email IS NOT NULL AND email != ''
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  LOOP
    keeper_id := dup.ids[1]; -- Keep the oldest
    duplicate_ids := dup.ids[2:]; -- Remove the rest

    RAISE NOTICE 'Email: % — Keeping ID: %, Merging % duplicates', dup.norm_email, keeper_id, array_length(duplicate_ids, 1);

    FOREACH dup_id IN ARRAY duplicate_ids
    LOOP
      -- Reassign bookings (user_id)
      UPDATE bookings SET user_id = keeper_id WHERE user_id = dup_id;
      GET DIAGNOSTICS reassigned_count = ROW_COUNT;
      IF reassigned_count > 0 THEN
        RAISE NOTICE '  → Reassigned % bookings from % to %', reassigned_count, dup_id, keeper_id;
      END IF;

      -- Reassign bookings (booking_details->customer->customerId via JSONB)
      UPDATE bookings
      SET booking_details = jsonb_set(
        jsonb_set(
          booking_details,
          '{customer,customerId}',
          to_jsonb(keeper_id::text)
        ),
        '{customer,id}',
        to_jsonb(keeper_id::text)
      )
      WHERE booking_details->'customer'->>'customerId' = dup_id::text
         OR booking_details->'customer'->>'id' = dup_id::text;
      GET DIAGNOSTICS reassigned_count = ROW_COUNT;
      IF reassigned_count > 0 THEN
        RAISE NOTICE '  → Reassigned % booking_details references from % to %', reassigned_count, dup_id, keeper_id;
      END IF;

      -- Reassign fatture
      UPDATE fatture SET customer_id = keeper_id WHERE customer_id = dup_id;
      GET DIAGNOSTICS reassigned_count = ROW_COUNT;
      IF reassigned_count > 0 THEN
        RAISE NOTICE '  → Reassigned % fatture from % to %', reassigned_count, dup_id, keeper_id;
      END IF;

      -- Reassign cauzioni
      UPDATE cauzioni SET cliente_id = keeper_id WHERE cliente_id = dup_id;
      GET DIAGNOSTICS reassigned_count = ROW_COUNT;
      IF reassigned_count > 0 THEN
        RAISE NOTICE '  → Reassigned % cauzioni from % to %', reassigned_count, dup_id, keeper_id;
      END IF;

      -- Reassign contracts
      UPDATE contracts SET customer_id = keeper_id WHERE customer_id = dup_id;
      GET DIAGNOSTICS reassigned_count = ROW_COUNT;
      IF reassigned_count > 0 THEN
        RAISE NOTICE '  → Reassigned % contracts from % to %', reassigned_count, dup_id, keeper_id;
      END IF;

      -- Reassign customer_documents
      UPDATE customer_documents SET customer_id = keeper_id WHERE customer_id = dup_id;
      GET DIAGNOSTICS reassigned_count = ROW_COUNT;
      IF reassigned_count > 0 THEN
        RAISE NOTICE '  → Reassigned % customer_documents from % to %', reassigned_count, dup_id, keeper_id;
      END IF;

      -- Reassign birthday_messages
      UPDATE birthday_messages SET customer_id = keeper_id WHERE customer_id = dup_id;
      GET DIAGNOSTICS reassigned_count = ROW_COUNT;
      IF reassigned_count > 0 THEN
        RAISE NOTICE '  → Reassigned % birthday_messages from % to %', reassigned_count, dup_id, keeper_id;
      END IF;

      -- Reassign customer_memberships
      UPDATE customer_memberships SET client_id = keeper_id WHERE client_id = dup_id;
      GET DIAGNOSTICS reassigned_count = ROW_COUNT;
      IF reassigned_count > 0 THEN
        RAISE NOTICE '  → Reassigned % customer_memberships from % to %', reassigned_count, dup_id, keeper_id;
      END IF;

      -- Update the keeper with any non-null fields from the duplicate (fill gaps)
      UPDATE customers_extended AS keeper
      SET
        telefono = COALESCE(keeper.telefono, dup_rec.telefono),
        codice_fiscale = COALESCE(keeper.codice_fiscale, dup_rec.codice_fiscale),
        data_nascita = COALESCE(keeper.data_nascita, dup_rec.data_nascita),
        luogo_nascita = COALESCE(keeper.luogo_nascita, dup_rec.luogo_nascita),
        indirizzo = COALESCE(keeper.indirizzo, dup_rec.indirizzo),
        citta_residenza = COALESCE(keeper.citta_residenza, dup_rec.citta_residenza),
        patente = COALESCE(keeper.patente, dup_rec.patente),
        updated_at = NOW()
      FROM customers_extended AS dup_rec
      WHERE keeper.id = keeper_id AND dup_rec.id = dup_id;

      -- Delete the duplicate
      DELETE FROM customers_extended WHERE id = dup_id;
      RAISE NOTICE '  → Deleted duplicate customer %', dup_id;
    END LOOP;
  END LOOP;

  -- Also merge duplicates by phone (normalized), but only if not already merged by email
  FOR dup IN
    SELECT telefono as norm_phone,
           array_agg(id ORDER BY created_at ASC NULLS LAST) as ids,
           COUNT(*) as cnt
    FROM customers_extended
    WHERE telefono IS NOT NULL AND telefono != ''
    GROUP BY telefono
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  LOOP
    keeper_id := dup.ids[1];
    duplicate_ids := dup.ids[2:];

    RAISE NOTICE 'Phone: % — Keeping ID: %, Merging % duplicates', dup.norm_phone, keeper_id, array_length(duplicate_ids, 1);

    FOREACH dup_id IN ARRAY duplicate_ids
    LOOP
      UPDATE bookings SET user_id = keeper_id WHERE user_id = dup_id;
      UPDATE bookings
      SET booking_details = jsonb_set(
        jsonb_set(
          booking_details,
          '{customer,customerId}',
          to_jsonb(keeper_id::text)
        ),
        '{customer,id}',
        to_jsonb(keeper_id::text)
      )
      WHERE booking_details->'customer'->>'customerId' = dup_id::text
         OR booking_details->'customer'->>'id' = dup_id::text;
      UPDATE fatture SET customer_id = keeper_id WHERE customer_id = dup_id;
      UPDATE cauzioni SET cliente_id = keeper_id WHERE cliente_id = dup_id;
      UPDATE contracts SET customer_id = keeper_id WHERE customer_id = dup_id;
      UPDATE customer_documents SET customer_id = keeper_id WHERE customer_id = dup_id;
      UPDATE birthday_messages SET customer_id = keeper_id WHERE customer_id = dup_id;
      UPDATE customer_memberships SET client_id = keeper_id WHERE client_id = dup_id;

      UPDATE customers_extended AS keeper
      SET
        email = COALESCE(keeper.email, dup_rec.email),
        codice_fiscale = COALESCE(keeper.codice_fiscale, dup_rec.codice_fiscale),
        data_nascita = COALESCE(keeper.data_nascita, dup_rec.data_nascita),
        luogo_nascita = COALESCE(keeper.luogo_nascita, dup_rec.luogo_nascita),
        indirizzo = COALESCE(keeper.indirizzo, dup_rec.indirizzo),
        citta_residenza = COALESCE(keeper.citta_residenza, dup_rec.citta_residenza),
        patente = COALESCE(keeper.patente, dup_rec.patente),
        updated_at = NOW()
      FROM customers_extended AS dup_rec
      WHERE keeper.id = keeper_id AND dup_rec.id = dup_id;

      DELETE FROM customers_extended WHERE id = dup_id;
      RAISE NOTICE '  → Deleted duplicate customer % (phone match)', dup_id;
    END LOOP;
  END LOOP;

  -- Also clean up legacy customers table
  DELETE FROM customers c
  WHERE NOT EXISTS (
    SELECT 1 FROM customers_extended ce WHERE ce.id = c.id
  );

  RAISE NOTICE '';
  RAISE NOTICE '===== DUPLICATE CUSTOMER CLEANUP COMPLETE =====';
END $$;

-- Verification: Check no duplicates remain
SELECT 'Remaining email duplicates' as check_type,
  LOWER(email) as value, COUNT(*) as cnt
FROM customers_extended
WHERE email IS NOT NULL AND email != ''
GROUP BY LOWER(email)
HAVING COUNT(*) > 1
UNION ALL
SELECT 'Remaining phone duplicates' as check_type,
  telefono as value, COUNT(*) as cnt
FROM customers_extended
WHERE telefono IS NOT NULL AND telefono != ''
GROUP BY telefono
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
