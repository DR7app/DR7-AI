-- 1. HISTORY (Bookings + Fatture)
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
        data_emissione as date,
        'Fattura #' || numero_fattura as description,
        importo_totale as amount, 
        'Fattura' as payment_method,
        stato as status
    FROM fatture 
    WHERE customer_name ILIKE '%Massimo%Runchina%'
)
ORDER BY date DESC;

-- 2. CHECK WALLET BALANCE (in Metadata)
SELECT 
    id, 
    nome, 
    cognome, 
    metadata 
FROM customers_extended 
WHERE email ILIKE '%massimorunchina69@gmail.com%';
