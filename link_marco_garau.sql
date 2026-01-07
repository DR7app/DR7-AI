-- Find Marco Garau's customer ID and the booking, then link them
WITH customer AS (
    SELECT id, nome, cognome, telefono
    FROM customers_extended
    WHERE telefono = '3517083580'
       OR (nome ILIKE '%Marco%' AND cognome ILIKE '%Garau%')
    LIMIT 1
),
booking AS (
    SELECT id, customer_name, customer_phone, user_id
    FROM bookings
    WHERE customer_phone = '3517083580'
       OR customer_name ILIKE '%Marco%Garau%'
    ORDER BY created_at DESC
    LIMIT 1
)
UPDATE bookings
SET user_id = (SELECT id FROM customer)
WHERE id = (SELECT id FROM booking)
RETURNING 
    id as booking_id,
    customer_name,
    user_id as linked_customer_id,
    'Successfully linked!' as status;
