-- Fix codice_postale VARCHAR(5) limit to accommodate international postal codes
-- This resolves the "value too long for type character varying(5)" error

-- Increase codice_postale length from VARCHAR(5) to VARCHAR(10)
ALTER TABLE customers_extended
ALTER COLUMN codice_postale TYPE VARCHAR(10);

-- Add comment
COMMENT ON COLUMN customers_extended.codice_postale IS 'CAP/Postal Code - Supports Italian (5 digits) and international codes (up to 10 chars)';

-- Verify the change
SELECT
    column_name,
    data_type,
    character_maximum_length,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'customers_extended'
AND column_name = 'codice_postale';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Fixed codice_postale length limit!';
    RAISE NOTICE 'Changed from VARCHAR(5) to VARCHAR(10)';
    RAISE NOTICE 'Now supports international postal codes';
END $$;
