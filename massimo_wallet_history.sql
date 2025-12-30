-- 1. DEEP SEARCH FOR ANY LEDGER/TRANSACTION TABLE
SELECT table_name 
FROM information_schema.tables 
WHERE table_name ILIKE '%transac%' 
   OR table_name ILIKE '%ledger%' 
   OR table_name ILIKE '%log%' 
   OR table_name ILIKE '%history%'
   OR table_name ILIKE '%wallet%'
   OR table_name ILIKE '%credit%';

-- 2. GENERATE A "TRANSACTION HISTORY" from Bookings & Invoices
-- This reconstructs the history if no dedicated table exists.
(
    SELECT 
        'Booking (Usage)' as type,
        created_at as date,
        vehicle_name as description,
        -price_total as amount,  -- Negative because it's spending
        payment_method,
        status
    FROM bookings 
    WHERE customer_email ILIKE '%massimorunchina69@gmail.com%'
       OR customer_name ILIKE '%Massimo%Runchina%'
)
UNION ALL
(
    SELECT 
        'Invoice (Payment)' as type,
        invoice_date as date,
        'Invoice #' || invoice_number as description,
        total as amount,         -- Positive as it might be adding credit? Or just a record of payment.
        payment_method,
        status
    FROM invoices 
    WHERE customer_name ILIKE '%Massimo%Runchina%'
)
ORDER BY date DESC;
