-- Check what's actually in the customer_data JSONB column
SELECT 
    ticket_number,
    email,
    full_name,
    customer_phone,
    customer_data,
    jsonb_pretty(customer_data) as formatted_customer_data
FROM commercial_operation_tickets
WHERE email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it')
LIMIT 3;
