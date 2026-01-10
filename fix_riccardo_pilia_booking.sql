-- Fix RICCARDO PILIA booking to link to correct customer
-- Step 1: Find the customer ID
WITH customer_info AS (
    SELECT id, nome, cognome, email, telefono
    FROM customers_extended
    WHERE nome ILIKE '%RICCARDO%'
      AND cognome ILIKE '%PILIA%'
    LIMIT 1
),
booking_info AS (
    SELECT id, customer_name, customer_email, user_id, booking_details
    FROM bookings
    WHERE customer_name ILIKE '%RICCARDO%PILIA%'
       OR customer_email ILIKE '%pilia%'
    ORDER BY created_at DESC
    LIMIT 1
)
-- Step 2: Update the booking to link to the customer
UPDATE bookings
SET 
    user_id = (SELECT id FROM customer_info),
    booking_details = jsonb_set(
        jsonb_set(
            COALESCE(booking_details, '{}'::jsonb),
            '{customer,id}',
            to_jsonb((SELECT id FROM customer_info)::text)
        ),
        '{customer,customerId}',
        to_jsonb((SELECT id FROM customer_info)::text)
    )
WHERE id = (SELECT id FROM booking_info)
RETURNING 
    id as booking_id,
    customer_name,
    user_id as updated_user_id,
    booking_details->'customer'->>'id' as customer_id,
    booking_details->'customer'->>'customerId' as customer_customerId;
