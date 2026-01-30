-- Birthday Discount Codes Table
-- Stores unique discount codes generated for birthday messages

CREATE TABLE IF NOT EXISTS birthday_discount_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers_extended(id) ON DELETE CASCADE,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),

    -- Discount details
    rental_credit DECIMAL(10,2) DEFAULT 100.00,  -- €100 for rental
    car_wash_discount DECIMAL(10,2) DEFAULT 10.00,  -- €10 for car wash

    -- Usage tracking
    rental_used BOOLEAN DEFAULT FALSE,
    car_wash_used BOOLEAN DEFAULT FALSE,
    rental_used_at TIMESTAMPTZ,
    car_wash_used_at TIMESTAMPTZ,
    rental_booking_id UUID,
    car_wash_booking_id UUID,

    -- Validity
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days'),  -- Valid for 90 days

    -- Metadata
    sent_via VARCHAR(50) DEFAULT 'whatsapp',
    notes TEXT
);

-- Index for fast code lookup
CREATE INDEX IF NOT EXISTS idx_birthday_codes_code ON birthday_discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_birthday_codes_customer ON birthday_discount_codes(customer_id);
CREATE INDEX IF NOT EXISTS idx_birthday_codes_expires ON birthday_discount_codes(expires_at);

-- Enable RLS
ALTER TABLE birthday_discount_codes ENABLE ROW LEVEL SECURITY;

-- Policy for service role (full access)
CREATE POLICY "Service role full access" ON birthday_discount_codes
    FOR ALL USING (true) WITH CHECK (true);

-- Policy for anon users to validate codes (read only)
CREATE POLICY "Anon can validate codes" ON birthday_discount_codes
    FOR SELECT USING (true);
