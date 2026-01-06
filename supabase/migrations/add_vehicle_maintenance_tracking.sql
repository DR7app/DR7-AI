-- Add maintenance tracking fields to vehicles table
-- This migration adds fields for tracking tires, brakes, service intervals, and KM-based alerts

ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS current_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_tire_change_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS maintenance_tires_interval_km INTEGER DEFAULT 30000,
ADD COLUMN IF NOT EXISTS last_brake_change_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS maintenance_brake_interval_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_service_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_service_date DATE,
ADD COLUMN IF NOT EXISTS maintenance_service_interval_km INTEGER DEFAULT 30000,
ADD COLUMN IF NOT EXISTS insurance_expiry DATE,
ADD COLUMN IF NOT EXISTS tax_expiry DATE,
ADD COLUMN IF NOT EXISTS inspection_expiry DATE,
ADD COLUMN IF NOT EXISTS leasing_expiry DATE;

-- Add helpful comments
COMMENT ON COLUMN vehicles.current_km IS 'Current odometer reading in kilometers';
COMMENT ON COLUMN vehicles.last_tire_change_km IS 'KM at last tire change';
COMMENT ON COLUMN vehicles.maintenance_tires_interval_km IS 'Tire change interval in KM (default 30000)';
COMMENT ON COLUMN vehicles.last_brake_change_km IS 'KM at last brake pad change';
COMMENT ON COLUMN vehicles.maintenance_brake_interval_km IS 'Brake pad change interval in KM (0 = not monitored)';
COMMENT ON COLUMN vehicles.last_service_km IS 'KM at last service (tagliando)';
COMMENT ON COLUMN vehicles.last_service_date IS 'Date of last service';
COMMENT ON COLUMN vehicles.maintenance_service_interval_km IS 'Service interval in KM (default 30000)';
COMMENT ON COLUMN vehicles.insurance_expiry IS 'Insurance expiry date';
COMMENT ON COLUMN vehicles.tax_expiry IS 'Tax (bollo) expiry date';
COMMENT ON COLUMN vehicles.inspection_expiry IS 'Inspection (revisione) expiry date';
COMMENT ON COLUMN vehicles.leasing_expiry IS 'Leasing contract expiry date';
