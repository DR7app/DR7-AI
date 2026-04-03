-- Create preventivi (quotes) table
CREATE TABLE IF NOT EXISTS preventivi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vehicle info
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_name TEXT NOT NULL,
  vehicle_plate TEXT,
  vehicle_category TEXT, -- exotic, urban, aziendali

  -- Dates
  pickup_date TIMESTAMPTZ NOT NULL,
  dropoff_date TIMESTAMPTZ NOT NULL,
  pickup_location TEXT DEFAULT 'dr7_office',
  dropoff_location TEXT DEFAULT 'dr7_office',

  -- Fascia & Insurance
  fascia TEXT NOT NULL DEFAULT 'A', -- 'A' or 'B'
  insurance_option TEXT DEFAULT 'KASKO_BASE',
  insurance_daily NUMERIC(10,2) DEFAULT 0,

  -- KM
  km_limit INTEGER DEFAULT 0,
  unlimited_km BOOLEAN DEFAULT FALSE,
  km_overage_fee NUMERIC(10,2) DEFAULT 1.80,
  unlimited_km_daily NUMERIC(10,2) DEFAULT 0,

  -- Extras
  second_driver BOOLEAN DEFAULT FALSE,
  second_driver_daily NUMERIC(10,2) DEFAULT 0,
  no_cauzione BOOLEAN DEFAULT FALSE,
  no_cauzione_daily NUMERIC(10,2) DEFAULT 0,

  -- Delivery
  delivery_enabled BOOLEAN DEFAULT FALSE,
  delivery_address JSONB,
  delivery_fee NUMERIC(10,2) DEFAULT 0,
  pickup_enabled BOOLEAN DEFAULT FALSE,
  pickup_address JSONB,
  pickup_fee NUMERIC(10,2) DEFAULT 0,

  -- Pricing
  daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0, -- base vehicle rate per day
  rental_days INTEGER NOT NULL DEFAULT 1,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  deposit_amount NUMERIC(10,2) DEFAULT 0,

  -- Notes
  notes TEXT,

  -- Client (nullable - attached later)
  customer_id UUID,
  customer_name TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'preventivo', -- preventivo, convertito, scaduto
  booking_id UUID, -- linked booking when converted

  -- PDF
  pdf_url TEXT,

  -- Validity
  valid_until DATE,

  -- Metadata
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for listing
CREATE INDEX idx_preventivi_status ON preventivi(status);
CREATE INDEX idx_preventivi_created_at ON preventivi(created_at DESC);
CREATE INDEX idx_preventivi_customer_id ON preventivi(customer_id);

-- RLS
ALTER TABLE preventivi ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (admin)
CREATE POLICY "Allow all for authenticated" ON preventivi
  FOR ALL USING (true) WITH CHECK (true);
