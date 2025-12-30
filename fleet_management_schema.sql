-- Add fleet management columns to vehicles table
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS current_km INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS insurance_expiry DATE,
ADD COLUMN IF NOT EXISTS tax_expiry DATE, -- Bollo
ADD COLUMN IF NOT EXISTS inspection_expiry DATE, -- Revisione
ADD COLUMN IF NOT EXISTS leasing_expiry DATE;

-- Create vehicle_maintenance table
CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  last_service_km INTEGER,
  last_service_date DATE,
  service_interval_km INTEGER DEFAULT 15000,
  service_interval_months INTEGER,
  
  last_tire_change_front_km INTEGER,
  last_tire_change_front_date DATE,
  last_tire_change_rear_km INTEGER,
  last_tire_change_rear_date DATE,
  tire_interval_km INTEGER,
  
  last_brake_change_front_km INTEGER,
  last_brake_change_front_date DATE,
  last_brake_change_rear_km INTEGER,
  last_brake_change_rear_date DATE,
  brake_interval_km INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create vehicle_events table
CREATE TABLE IF NOT EXISTS vehicle_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'tagliando', 'gomme', 'freni', 'revisione', 'assicurazione', 'bollo', 'altro'
  event_date DATE NOT NULL,
  km INTEGER NOT NULL,
  cost DECIMAL(10,2),
  provider TEXT,
  notes TEXT,
  attachment_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS policies if needed (assuming mostly admin access)
ALTER TABLE vehicle_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_events ENABLE ROW LEVEL SECURITY;

-- Allow public/authenticated access for now (matching existing loose policies for easier dev)
-- Ideally should be restricted to admin
CREATE POLICY "Enable all access for authenticated users" ON vehicle_maintenance FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for authenticated users" ON vehicle_events FOR ALL USING (auth.role() = 'authenticated');
