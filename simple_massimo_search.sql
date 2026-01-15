-- ========================================
-- SIMPLE MASSIMO RUNCHINA BOOKING SEARCH
-- Only searches bookings table (no joins)
-- ========================================

-- Find ALL bookings for Massimo Runchina
SELECT 
    id,
    customer_name,
    customer_email,
    customer_phone,
    user_id,
    vehicle_name,
    vehicle_plate,
    pickup_date AT TIME ZONE 'Europe/Rome' as pickup_local,
    dropoff_date AT TIME ZONE 'Europe/Rome' as dropoff_local,
    status,
    service_type,
    price_total / 100.0 as total_price_eur,
    payment_status,
    payment_method,
    created_at AT TIME ZONE 'Europe/Rome' as created_local,
    booked_at AT TIME ZONE 'Europe/Rome' as booked_local
FROM bookings
WHERE 
    LOWER(COALESCE(customer_name, '')) LIKE '%massimo%runchina%'
    OR LOWER(COALESCE(customer_name, '')) LIKE '%runchina%massimo%'
    OR LOWER(COALESCE(customer_email, '')) LIKE '%runchina%'
    OR customer_phone LIKE '%336973849%'
    OR customer_phone LIKE '%3336973849%'
ORDER BY pickup_date DESC;

-- Summary
SELECT 
    COUNT(*) as total_bookings,
    COUNT(DISTINCT vehicle_name) as unique_vehicles,
    SUM(price_total) / 100.0 as total_spent_eur,
    MIN(pickup_date AT TIME ZONE 'Europe/Rome') as first_booking,
    MAX(pickup_date AT TIME ZONE 'Europe/Rome') as last_booking
FROM bookings
WHERE 
    LOWER(COALESCE(customer_name, '')) LIKE '%massimo%runchina%'
    OR LOWER(COALESCE(customer_name, '')) LIKE '%runchina%massimo%'
    OR LOWER(COALESCE(customer_email, '')) LIKE '%runchina%';
