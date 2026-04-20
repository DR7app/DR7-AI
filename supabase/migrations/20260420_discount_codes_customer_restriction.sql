-- Add per-customer restriction columns to discount_codes.
-- customer_email / customer_phone let admins bind a promotional code
-- to a single customer. Null/empty = public code (no restriction).

ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS customer_email TEXT;

ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_discount_codes_customer_email
  ON discount_codes (LOWER(customer_email))
  WHERE customer_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_discount_codes_customer_phone
  ON discount_codes (customer_phone)
  WHERE customer_phone IS NOT NULL;
