-- Search for booking by email: pisceddasandro87@gmail.com
-- This is the specific booking the user reported as missing

-- 1. Search in bookings table for this email
SELECT 
    id,
    customer_name,
    customer_email,
    customer_phone,
    service_type,
    service_name,
    appointment_date,
    appointment_time,
    status,
    payment_status,
    booking_source,
    created_at,
    updated_at
FROM bookings 
WHERE customer_email ILIKE '%pisceddasandro87@gmail.com%'
   OR guest_email ILIKE '%pisceddasandro87@gmail.com%'
ORDER BY created_at DESC;

-- 2. Check if there are ANY bookings with similar email
SELECT 
    id,
    customer_email,
    guest_email,
    customer_name,
    service_type,
    service_name,
    appointment_date,
    created_at
FROM bookings 
WHERE customer_email ILIKE '%piscedda%'
   OR guest_email ILIKE '%piscedda%'
   OR customer_name ILIKE '%piscedda%'
   OR guest_name ILIKE '%piscedda%'
ORDER BY created_at DESC;

-- 3. Check recent car wash bookings (last 7 days)
SELECT 
    id,
    customer_name,
    customer_email,
    service_name,
    appointment_date,
    appointment_time,
    status,
    created_at
FROM bookings 
WHERE service_type = 'car_wash'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- 4. Check if the booking exists but with NULL service_type
SELECT 
    id,
    customer_name,
    customer_email,
    service_type,
    service_name,
    appointment_date,
    status,
    created_at
FROM bookings 
WHERE (customer_email ILIKE '%pisceddasandro87@gmail.com%'
   OR guest_email ILIKE '%pisceddasandro87@gmail.com%')
  AND service_type IS NULL
ORDER BY created_at DESC;

-- 5. Check ALL recent bookings (any service type) for this email
SELECT 
    id,
    customer_name,
    customer_email,
    service_type,
    service_name,
    vehicle_name,
    appointment_date,
    pickup_date,
    status,
    payment_status,
    created_at
FROM bookings 
WHERE customer_email ILIKE '%pisceddasandro87@gmail.com%'
   OR guest_email ILIKE '%pisceddasandro87@gmail.com%'
ORDER BY created_at DESC
LIMIT 10;
