-- Debug payment fields to understand data structure
-- Check a sample of recent bookings to see where payment data is stored

SELECT 
    id,
    customer_name,
    price_total,
    amount_paid,
    payment_status,
    booking_details->'amount_paid' as bd_amount_paid_snake,
    booking_details->'amountPaid' as bd_amountPaid_camel,
    booking_details,
    service_type,
    status,
    pickup_date
FROM bookings
WHERE status != 'cancelled'
  AND service_type IS NULL OR service_type NOT IN ('car_wash', 'mechanical_service', 'mechanical')
ORDER BY created_at DESC
LIMIT 20;
