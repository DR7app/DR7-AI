(
    SELECT 
        'BOOKING' as type,
        created_at as date,
        vehicle_name as description,
        -price_total as amount,
        payment_method,
        status
    FROM bookings 
    WHERE customer_email ILIKE '%massimorunchina69@gmail.com%'
       OR customer_name ILIKE '%Massimo%Runchina%'
)
UNION ALL
(
    SELECT 
        'INVOICE' as type,
        invoice_date as date,
        'Invoice #' || invoice_number as description,
        total as amount, 
        payment_method,
        status
    FROM invoices 
    WHERE customer_name ILIKE '%Massimo%Runchina%'
)
ORDER BY date DESC;
