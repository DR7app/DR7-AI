-- Step 1: Find Marco Garau in customers_extended
SELECT 
    id,
    nome,
    cognome,
    email,
    telefono,
    tipo_cliente,
    codice_fiscale,
    indirizzo,
    citta_residenza
FROM customers_extended
WHERE 
    (nome ILIKE '%Marco%' AND cognome ILIKE '%Garau%')
    OR telefono = '3517083580'
    OR email ILIKE '%marco%garau%'
ORDER BY created_at DESC;

-- Step 2: Find the booking for Marco Garau
SELECT 
    id,
    customer_name,
    customer_phone,
    customer_email,
    user_id,
    vehicle_name,
    pickup_date,
    status,
    booking_details
FROM bookings
WHERE 
    customer_name ILIKE '%Marco%Garau%'
    OR customer_phone = '3517083580'
ORDER BY created_at DESC
LIMIT 5;

-- Step 3: After verifying the IDs above, update the booking with the correct customer ID
-- REPLACE 'CUSTOMER_ID_HERE' with the actual ID from Step 1
-- REPLACE 'BOOKING_ID_HERE' with the actual ID from Step 2
/*
UPDATE bookings
SET 
    user_id = 'CUSTOMER_ID_HERE',
    updated_at = NOW()
WHERE id = 'BOOKING_ID_HERE';
*/

-- Step 4: Verify the update
/*
SELECT 
    b.id,
    b.customer_name,
    b.user_id,
    c.nome,
    c.cognome,
    c.email,
    c.codice_fiscale
FROM bookings b
LEFT JOIN customers_extended c ON b.user_id = c.id
WHERE b.customer_name ILIKE '%Marco%Garau%'
ORDER BY b.created_at DESC
LIMIT 1;
*/
