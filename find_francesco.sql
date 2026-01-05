-- Find Francesco Balducci records by name
SELECT 
  id,
  nome,
  cognome,
  email,
  telefono,
  tipo_cliente,
  created_at,
  full_name
FROM customers_extended
WHERE (LOWER(nome) LIKE '%francesco%' OR LOWER(cognome) LIKE '%balducci%' OR LOWER(full_name) LIKE '%francesco%balducci%')
ORDER BY created_at;
