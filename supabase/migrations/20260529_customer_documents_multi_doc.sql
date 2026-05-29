-- ============================================================================
-- customer_documents: allow multiple documents per category (fronte / retro)
-- and accept free-form document_type keys.
-- ============================================================================
-- Why: NewClientModal uploads a "fronte" and a "retro" for each category
-- (Patente, Carta d'Identita, Codice Fiscale). Both inserts used to share the
-- SAME document_type, so the second one (the retro) tripped
-- UNIQUE(customer_id, document_type) and the upload silently failed — that is
-- why "2 docs per category" stopped working. The document_type ENUM also
-- rejected codice_fiscale outright. We now store a distinct document_type per
-- slot: drivers_license_front/_back, identity_document_front/_back,
-- codice_fiscale_front/_back (same convention already used by libretto_front/
-- libretto_back). Legacy single rows (drivers_license, identity_document) are
-- preserved and still render as the "fronte".
-- ============================================================================

-- 1. Allow multiple documents per type per customer.
--    Drop the unique constraint by its known name, and defensively drop any
--    other unique constraint / index that still spans document_type (the live
--    schema may have diverged from the original create script).
ALTER TABLE customer_documents
  DROP CONSTRAINT IF EXISTS unique_customer_document_type;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'customer_documents'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%document_type%'
  LOOP
    EXECUTE format('ALTER TABLE customer_documents DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'customer_documents'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%document_type%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
  END LOOP;
END $$;

-- 2. Accept any document_type key. The column was an ENUM that only knew a
--    fixed handful of values; ::text preserves every existing row value as-is.
ALTER TABLE customer_documents
  ALTER COLUMN document_type TYPE text USING document_type::text;

-- NOTE: the now-unused ENUM type `document_type` is intentionally left in
-- place. Dropping it is optional and only safe once nothing else references
-- it (DROP TYPE IF EXISTS document_type; — will error if dependencies remain).

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'customer_documents' AND column_name = 'document_type';
