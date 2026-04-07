-- Enhance preventivi table for reporting: event tracking + performance indices

-- Events tracking: JSONB array of {event, ts, value?, context?}
-- Used by Report Preventivi funnel analysis
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS events JSONB DEFAULT '[]'::jsonb;

-- Performance indices for report queries
CREATE INDEX IF NOT EXISTS idx_preventivi_pickup_date ON preventivi(pickup_date);
CREATE INDEX IF NOT EXISTS idx_preventivi_vehicle_name ON preventivi(vehicle_name);
CREATE INDEX IF NOT EXISTS idx_preventivi_total_final ON preventivi(total_final);
CREATE INDEX IF NOT EXISTS idx_preventivi_driver_tier ON preventivi(driver_tier);
