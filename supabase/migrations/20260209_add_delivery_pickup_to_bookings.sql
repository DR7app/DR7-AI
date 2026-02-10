-- Migration: Add home delivery & pickup columns to bookings table
-- Date: 2026-02-09
-- Description: Supports "Consegna a domicilio" and "Ritiro a domicilio" features
--   delivery_enabled / pickup_enabled: boolean flags
--   delivery_address / pickup_address: JSONB with street, city, zip, province, notes
--   delivery_fee / pickup_fee: integer cents (same convention as price_total)

-- Home Delivery columns
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_address jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivery_fee integer NOT NULL DEFAULT 0;

-- Home Pickup columns
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pickup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_address jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pickup_fee integer NOT NULL DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN bookings.delivery_enabled IS 'Whether home delivery (consegna a domicilio) is enabled for this booking';
COMMENT ON COLUMN bookings.delivery_address IS 'JSONB: {street, city, zip, province, notes} - delivery destination address';
COMMENT ON COLUMN bookings.delivery_fee IS 'Delivery fee in cents (e.g. 5000 = €50.00). Added to price_total.';
COMMENT ON COLUMN bookings.pickup_enabled IS 'Whether home pickup (ritiro a domicilio) is enabled for this booking';
COMMENT ON COLUMN bookings.pickup_address IS 'JSONB: {street, city, zip, province, notes} - pickup address at checkout';
COMMENT ON COLUMN bookings.pickup_fee IS 'Pickup fee in cents (e.g. 5000 = €50.00). Added to price_total.';

-- Add check constraints for fee values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_fee_non_negative') THEN
    ALTER TABLE bookings ADD CONSTRAINT delivery_fee_non_negative CHECK (delivery_fee >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pickup_fee_non_negative') THEN
    ALTER TABLE bookings ADD CONSTRAINT pickup_fee_non_negative CHECK (pickup_fee >= 0);
  END IF;
END $$;
