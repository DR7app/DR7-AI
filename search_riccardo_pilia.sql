-- Search for RICCARDO PILIA in customers_extended
SELECT 'customers_extended' as table_name, id, nome, cognome, email, telefono, created_at 
FROM customers_extended 
WHERE (LOWER(nome) LIKE '%riccardo%' AND LOWER(cognome) LIKE '%pilia%')
   OR LOWER(nome || ' ' || cognome) LIKE '%riccardo%pilia%'
ORDER BY created_at DESC;

-- Search for RICCARDO PILIA in customers (legacy)
SELECT 'customers' as table_name, id, full_name, email, phone, created_at 
FROM customers 
WHERE LOWER(full_name) LIKE '%riccardo%pilia%'
ORDER BY created_at DESC;

-- Also check bookings with this customer name
SELECT 'bookings' as table_name, id, customer_name, customer_email, customer_phone, user_id, created_at
FROM bookings
WHERE LOWER(customer_name) LIKE '%riccardo%pilia%'
ORDER BY created_at DESC
LIMIT 10;
