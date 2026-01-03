-- Check if customer_data column exists in commercial_operation_tickets
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'commercial_operation_tickets' 
AND column_name = 'customer_data';

-- Check what's in the customer_data JSONB column for these tickets
SELECT 
    ticket_number,
    email,
    full_name,
    customer_data
FROM commercial_operation_tickets
WHERE email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it')
LIMIT 5;

-- Check the structure of customer_data for all tickets
SELECT 
    ticket_number,
    email,
    jsonb_pretty(customer_data) as customer_data_formatted
FROM commercial_operation_tickets
WHERE customer_data IS NOT NULL
LIMIT 3;
