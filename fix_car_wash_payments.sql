-- CORRECT FIX: For "Da Saldare" bookings, amountPaid should be 0
-- This makes the "remaining amount" = total, which is what shows in the Da Saldare column

-- First, check current state
SELECT 
    id,
    customer_name,
    service_name,
    price_total,
    payment_status,
    booking_details->>'amountPaid' as current_amount_paid,
    price_total - COALESCE((booking_details->>'amountPaid')::int, 0) as remaining
FROM bookings
WHERE service_type = 'car_wash'
    AND payment_status = 'pending';

-- CORRECT UPDATE: Set amountPaid to 0 for pending car wash bookings
-- This will make the "Da Saldare" column show the full amount (€25.00)
UPDATE bookings
SET booking_details = jsonb_set(
    COALESCE(booking_details, '{}'::jsonb),
    '{amountPaid}',
    '0'::jsonb
)
WHERE service_type = 'car_wash'
    AND payment_status = 'pending';

-- Verify the fix
SELECT 
    id,
    customer_name,
    service_name,
    price_total,
    payment_status,
    booking_details->>'amountPaid' as updated_amount_paid,
    price_total - COALESCE((booking_details->>'amountPaid')::int, 0) as remaining_to_pay
FROM bookings
WHERE service_type = 'car_wash'
    AND payment_status = 'pending'
ORDER BY created_at DESC;
