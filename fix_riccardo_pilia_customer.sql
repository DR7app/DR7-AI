-- Fix for Riccardo PILIA missing customer record
-- This script will:
-- 1. Find his booking data
-- 2. Extract customer information from the booking
-- 3. Create a customer_extended record if missing

-- Step 1: Find Riccardo PILIA's bookings and extract customer data
SELECT 
    id as booking_id,
    user_id,
    customer_name,
    customer_email,
    customer_phone,
    booking_details,
    booking_details->'customer' as customer_object,
    booking_details->'customer'->>'id' as customer_id_from_details,
    booking_details->'customer'->>'customerId' as customer_customerId_from_details,
    booking_details->'customer'->>'fullName' as customer_fullname,
    booking_details->'customer'->>'email' as customer_email_from_details,
    booking_details->'customer'->>'phone' as customer_phone_from_details
FROM bookings
WHERE 
    LOWER(customer_name) LIKE '%riccardo%pilia%'
    OR LOWER(customer_name) LIKE '%pilia%riccardo%'
ORDER BY created_at DESC;

-- Step 2: Check if customer exists in customers_extended
-- (Run this after seeing the results from Step 1 to get the actual user_id)

-- Step 3: Check auth.users for this customer
-- SELECT id, email, raw_user_meta_data
-- FROM auth.users
-- WHERE id = 'USER_ID_FROM_STEP_1';

-- Step 4: Create customer record if missing
-- IMPORTANT: Only run this after confirming the customer doesn't exist
-- Replace the placeholders with actual data from Step 1

/*
INSERT INTO customers_extended (
    id,
    tipo_cliente,
    nome,
    cognome,
    email,
    telefono,
    created_at,
    updated_at
) VALUES (
    'USER_ID_FROM_BOOKING',  -- Use user_id from the booking
    'persona_fisica',
    'RICCARDO',
    'PILIA',
    'EMAIL_FROM_BOOKING',    -- Use customer_email from booking
    'PHONE_FROM_BOOKING',    -- Use customer_phone from booking
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    nome = EXCLUDED.nome,
    cognome = EXCLUDED.cognome,
    email = EXCLUDED.email,
    telefono = EXCLUDED.telefono,
    updated_at = NOW();
*/

-- Step 5: Verify the fix
-- SELECT * FROM customers_extended WHERE cognome ILIKE '%pilia%' AND nome ILIKE '%riccardo%';
