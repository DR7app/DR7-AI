-- Check if RICCARDO PILIA is in customers_extended
SELECT id, nome, cognome, email, telefono, source, created_at
FROM customers_extended
WHERE LOWER(email) = 'r.p.system.srl@gmail.com';
