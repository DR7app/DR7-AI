-- Add separate maintenance interval columns for front and rear tires and brakes
-- This allows independent tracking of maintenance intervals for front and rear components

-- Add new columns for tire maintenance intervals
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS maintenance_tires_front_interval_km INTEGER,
ADD COLUMN IF NOT EXISTS maintenance_tires_rear_interval_km INTEGER;

-- Add new columns for brake maintenance intervals
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS maintenance_brake_front_interval_km INTEGER,
ADD COLUMN IF NOT EXISTS maintenance_brake_rear_interval_km INTEGER;

-- Migrate existing data: copy the old shared interval to both front and rear
-- Only update where the new columns are NULL and the old column has a value
UPDATE vehicles 
SET 
  maintenance_tires_front_interval_km = maintenance_tires_interval_km,
  maintenance_tires_rear_interval_km = maintenance_tires_interval_km
WHERE 
  maintenance_tires_interval_km IS NOT NULL 
  AND maintenance_tires_front_interval_km IS NULL 
  AND maintenance_tires_rear_interval_km IS NULL;

UPDATE vehicles 
SET 
  maintenance_brake_front_interval_km = maintenance_brake_interval_km,
  maintenance_brake_rear_interval_km = maintenance_brake_interval_km
WHERE 
  maintenance_brake_interval_km IS NOT NULL 
  AND maintenance_brake_front_interval_km IS NULL 
  AND maintenance_brake_rear_interval_km IS NULL;

-- Note: We keep the old columns (maintenance_tires_interval_km and maintenance_brake_interval_km)
-- for backward compatibility. They are marked as legacy in the TypeScript types.
