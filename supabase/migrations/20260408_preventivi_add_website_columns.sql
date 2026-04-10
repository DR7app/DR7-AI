-- Add missing columns needed by website create-website-preventivo function
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'admin';
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers_extended(id);
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS pickup_location TEXT DEFAULT 'dr7_office';
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS dropoff_location TEXT DEFAULT 'dr7_office';
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS km_limit INT DEFAULT 0;
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS unlimited_km BOOLEAN DEFAULT false;
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS km_overage_fee NUMERIC(10,2) DEFAULT 1.80;
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) DEFAULT 0;
ALTER TABLE preventivi ADD COLUMN IF NOT EXISTS pickup_fee NUMERIC(10,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_preventivi_source ON preventivi(source);
CREATE INDEX IF NOT EXISTS idx_preventivi_customer ON preventivi(customer_id);
