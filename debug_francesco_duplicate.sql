-- Diagnostic query to see why Francesco Balducci isn't merging
-- Run this to see the exact data

SELECT 
  id,
  nome,
  cognome,
  email,
  telefono,
  LENGTH(nome) as nome_length,
  LENGTH(cognome) as cognome_length,
  LENGTH(TRIM(nome)) as nome_trimmed_length,
  LENGTH(TRIM(cognome)) as cognome_trimmed_length,
  LOWER(TRIM(nome)) as nome_lower,
  LOWER(TRIM(cognome)) as cognome_lower,
  LOWER(email) as email_lower,
  created_at
FROM customers_extended
WHERE LOWER(email) = 'sara.marceddu79@icloud.com'
ORDER BY created_at;
