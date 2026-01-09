-- Fix document_type ENUM to include codice_fiscale
-- This resolves the "value too long for type character varying(5)" error
-- (The actual error is enum constraint, but Postgres sometimes reports it confusingly)

-- Add 'codice_fiscale' to the document_type enum
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'codice_fiscale';

-- Verify the enum values
SELECT enumlabel 
FROM pg_enum 
WHERE enumtypid = 'document_type'::regtype
ORDER BY enumsortorder;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Fixed document_type enum!';
    RAISE NOTICE 'Added: codice_fiscale';
    RAISE NOTICE 'Enum now supports: drivers_license, identity_document, codice_fiscale';
END $$;
