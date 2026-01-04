-- Search by email in customers_extended
SELECT 'customers_extended' as source, id, nome, cognome, email, telefono, created_at, updated_at
FROM customers_extended 
WHERE LOWER(email) = 'r.p.system.srl@gmail.com'
ORDER BY created_at DESC;

-- Search by email in legacy customers
SELECT 'customers' as source, id, full_name, email, phone, created_at
FROM customers 
WHERE LOWER(email) = 'r.p.system.srl@gmail.com'
ORDER BY created_at DESC;

-- Check if there are ANY customers with similar names (case insensitive, partial match)
SELECT 'customers_extended_similar' as source, id, nome, cognome, email, telefono, created_at
FROM customers_extended 
WHERE LOWER(nome) LIKE '%riccardo%' OR LOWER(cognome) LIKE '%pilia%'
ORDER BY created_at DESC
LIMIT 10;
