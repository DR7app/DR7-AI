-- Check what data is stored in the lottery tickets table itself
SELECT 
    ticket_number,
    email,
    full_name,
    customer_phone,
    payment_intent_id,
    purchase_date
FROM commercial_operation_tickets
WHERE email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it')
LIMIT 3;

-- Check if there are any bookings for these customers that might have their data
SELECT 
    customer_email,
    customer_name,
    customer_phone,
    booking_details
FROM bookings
WHERE customer_email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it')
LIMIT 3;

-- Check auth.users to see if they have accounts
SELECT 
    id,
    email,
    created_at,
    raw_user_meta_data
FROM auth.users
WHERE email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it');
