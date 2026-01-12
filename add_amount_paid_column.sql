-- Add amount_paid column to bookings table
-- This column stores the amount already paid by the customer (in cents, like price_total)

ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS amount_paid INTEGER DEFAULT 0;

COMMENT ON COLUMN bookings.amount_paid IS 'Amount paid by customer in cents (e.g., 5000 = €50.00)';

-- Backfill existing bookings: if payment_status is 'paid', set amount_paid = price_total
UPDATE bookings
SET amount_paid = price_total
WHERE payment_status = 'paid' AND amount_paid IS NULL;

-- For unpaid bookings, set to 0
UPDATE bookings
SET amount_paid = 0
WHERE payment_status != 'paid' AND amount_paid IS NULL;
