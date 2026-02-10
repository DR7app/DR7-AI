-- Add front parking sensors columns
ALTER TABLE fleet_vehicle_inventory
  ADD COLUMN IF NOT EXISTS sensori_ant_model text,
  ADD COLUMN IF NOT EXISTS sensori_ant_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sensori_ant_supplier_url text,
  ADD COLUMN IF NOT EXISTS sensori_ant_supplier_phone text;

-- Add rear parking sensors columns
ALTER TABLE fleet_vehicle_inventory
  ADD COLUMN IF NOT EXISTS sensori_post_model text,
  ADD COLUMN IF NOT EXISTS sensori_post_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sensori_post_supplier_url text,
  ADD COLUMN IF NOT EXISTS sensori_post_supplier_phone text;
