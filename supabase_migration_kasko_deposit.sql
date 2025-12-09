-- Migration: Add Kasko Insurance and Deposit Support to Bookings
-- This migration ensures the booking_details JSONB column can store insurance options and deposit information

-- The bookings table should already have a booking_details column of type JSONB
-- This migration adds a comment to document the expected structure

COMMENT ON COLUMN bookings.booking_details IS 
'JSONB column storing additional booking information including:
- insuranceOption: Kasko tier (KASKO_BASE, KASKO_BLACK, KASKO_SIGNATURE)
- deposit: Deposit amount in euros (string)
- customer: Customer details object
- pickupLocation: Pickup location code
- dropoffLocation: Dropoff location code
- amountPaid: Amount paid in cents
- source: Booking source (admin_manual, website, etc.)
- second_driver: Second driver details object (optional)';

-- Create an index on booking_details->>'insuranceOption' for faster queries
CREATE INDEX IF NOT EXISTS idx_bookings_insurance_option 
ON bookings ((booking_details->>'insuranceOption'));

-- Create an index on booking_details->>'deposit' for faster queries
CREATE INDEX IF NOT EXISTS idx_bookings_deposit 
ON bookings ((booking_details->>'deposit'));

-- Verify the booking_details column exists and is JSONB
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bookings' 
        AND column_name = 'booking_details' 
        AND data_type = 'jsonb'
    ) THEN
        RAISE EXCEPTION 'booking_details column does not exist or is not JSONB type in bookings table';
    END IF;
END $$;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Kasko and Deposit migration completed successfully';
END $$;
