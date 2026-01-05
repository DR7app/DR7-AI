-- Check for all customers with "francesco" in the name
SELECT 
  id,
  nome,
  cognome,
  email,
  telefono,
  codice_fiscale,
  created_at,
  full_name
FROM customers_extended
WHERE LOWER(nome) LIKE '%francesco%' 
   OR LOWER(cognome) LIKE '%francesco%'
   OR LOWER(email) LIKE '%francesco%'
ORDER BY created_at DESC;
