-- Migration: Add kilometer overage fee field to bookings
-- This allows admins to specify the per-km overage charge when creating bookings

-- Add km_overage_fee column to bookings table
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS km_overage_fee DECIMAL(10,2) DEFAULT 0.00;

-- Add comment for documentation
COMMENT ON COLUMN bookings.km_overage_fee IS 'Cost per kilometer over the allowed limit (Sforo per KM)';

-- Example values:
-- Urban cars: typically €0.30 - €0.50 per km
-- Supercar: typically €1.00 - €2.00 per km
