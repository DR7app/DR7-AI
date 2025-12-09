-- Create birthday_vouchers table to track sent birthday vouchers
CREATE TABLE IF NOT EXISTS birthday_vouchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers_extended(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  birthday_date DATE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  voucher_year INTEGER NOT NULL,
  email_sent BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_birthday_vouchers_customer_id ON birthday_vouchers(customer_id);
CREATE INDEX IF NOT EXISTS idx_birthday_vouchers_year ON birthday_vouchers(voucher_year);
CREATE INDEX IF NOT EXISTS idx_birthday_vouchers_sent_at ON birthday_vouchers(sent_at);

-- Add comment
COMMENT ON TABLE birthday_vouchers IS 'Tracks birthday vouchers sent to customers to prevent duplicates';
