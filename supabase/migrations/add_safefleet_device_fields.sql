-- Link vehicles to SafeFleet GPS devices (portale.safefleet.it)
-- safefleet_device_id: stable id used by SafeFleet API to address the device
-- safefleet_imei: optional fallback identifier (IMEI of the GPS tracker)

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS safefleet_device_id text,
  ADD COLUMN IF NOT EXISTS safefleet_imei text;

CREATE INDEX IF NOT EXISTS idx_vehicles_safefleet_device_id
  ON vehicles (safefleet_device_id)
  WHERE safefleet_device_id IS NOT NULL;
