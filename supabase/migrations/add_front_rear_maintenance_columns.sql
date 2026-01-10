-- Add front/rear specific maintenance tracking columns to vehicles table
-- This migration adds separate tracking for front and rear tires and brake pads

ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS last_tire_change_front_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_tire_change_rear_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_brake_change_front_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_brake_change_rear_km INTEGER DEFAULT 0;

-- Add helpful comments
COMMENT ON COLUMN vehicles.last_tire_change_front_km IS 'KM at last front tire change';
COMMENT ON COLUMN vehicles.last_tire_change_rear_km IS 'KM at last rear tire change';
COMMENT ON COLUMN vehicles.last_brake_change_front_km IS 'KM at last front brake pad change';
COMMENT ON COLUMN vehicles.last_brake_change_rear_km IS 'KM at last rear brake pad change';

-- Migrate existing data from legacy columns to front-specific columns
-- This ensures backward compatibility for vehicles that already have tire/brake change data
UPDATE vehicles 
SET 
  last_tire_change_front_km = COALESCE(last_tire_change_km, 0),
  last_tire_change_rear_km = COALESCE(last_tire_change_km, 0),
  last_brake_change_front_km = COALESCE(last_brake_change_km, 0),
  last_brake_change_rear_km = COALESCE(last_brake_change_km, 0)
WHERE 
  last_tire_change_front_km = 0 
  OR last_brake_change_front_km = 0;
