-- Add metadata and missing address fields to customers_extended
ALTER TABLE customers_extended
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS codice_postale TEXT;

COMMENT ON COLUMN customers_extended.metadata IS 'Stores extended fields like sesso, patente details, sede operativa, legal representative info';
COMMENT ON COLUMN customers_extended.codice_postale IS 'CAP/Postal Code';

-- Ensure bookings table has booking_details JSONB
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS booking_details JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN bookings.booking_details IS 'Stores complex booking info like customer snapshot, second driver details, notes';

-- Create index on metadata for faster JSON queries if needed
CREATE INDEX IF NOT EXISTS idx_customers_extended_metadata ON customers_extended USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_details ON bookings USING gin (booking_details);

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Schema update completed successfully!';
    RAISE NOTICE 'Added/Verified columns:';
    RAISE NOTICE '  - customers_extended: metadata (JSONB), codice_postale (TEXT)';
    RAISE NOTICE '  - bookings: booking_details (JSONB)';
END $$;
