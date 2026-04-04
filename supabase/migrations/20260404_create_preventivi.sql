-- Preventivi (Quotes) table
-- Stores rental quotes with full pricing breakdown, WhatsApp tracking, and booking conversion

CREATE TABLE IF NOT EXISTS preventivi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Veicolo
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_name TEXT NOT NULL,
  vehicle_plate TEXT,
  vehicle_category TEXT,
  vehicle_model_year INT,
  vehicle_cv INT,
  vehicle_0_100 NUMERIC(4,1),

  -- Date
  pickup_date TIMESTAMPTZ NOT NULL,
  dropoff_date TIMESTAMPTZ NOT NULL,
  rental_days INT NOT NULL,

  -- Pricing
  base_daily_rate NUMERIC(10,2) NOT NULL,
  maggiorazione_pct NUMERIC(5,2) DEFAULT 0,
  daily_rate_after_markup NUMERIC(10,2),

  -- Extras
  insurance_option TEXT,
  insurance_daily_price NUMERIC(10,2) DEFAULT 0,
  insurance_total NUMERIC(10,2) DEFAULT 0,
  lavaggio_fee NUMERIC(10,2) DEFAULT 0,
  no_cauzione_daily NUMERIC(10,2) DEFAULT 0,
  no_cauzione_total NUMERIC(10,2) DEFAULT 0,
  unlimited_km_daily NUMERIC(10,2) DEFAULT 0,
  unlimited_km_total NUMERIC(10,2) DEFAULT 0,
  second_driver_daily NUMERIC(10,2) DEFAULT 0,
  second_driver_total NUMERIC(10,2) DEFAULT 0,

  -- Totali
  subtotal NUMERIC(10,2) NOT NULL,
  sconto NUMERIC(10,2) DEFAULT 0,
  sconto_note TEXT,
  total_final NUMERIC(10,2) NOT NULL,

  -- Revenue engine trace + extras detail
  pricing_trace JSONB,
  extras_detail JSONB,

  -- Cliente
  customer_phone TEXT,
  customer_name TEXT,
  driver_tier TEXT,

  -- Status workflow
  status TEXT NOT NULL DEFAULT 'bozza'
    CHECK (status IN ('bozza','inviato','accettato','rifiutato','scaduto')),
  booking_id UUID REFERENCES bookings(id),

  -- WhatsApp tracking
  whatsapp_sent_at TIMESTAMPTZ,
  whatsapp_message_id TEXT,

  -- Audit
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_preventivi_status ON preventivi(status);
CREATE INDEX idx_preventivi_vehicle ON preventivi(vehicle_id);
CREATE INDEX idx_preventivi_created ON preventivi(created_at DESC);

-- RLS: allow authenticated admins full access
ALTER TABLE preventivi ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage preventivi"
  ON preventivi FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
