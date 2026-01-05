-- Check if columns exist and see sample data
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'customers_extended' 
AND column_name IN ('nome', 'cognome', 'sesso', 'data_nascita', 'ente_ufficio', 'citta')
ORDER BY column_name;

-- Check a specific customer record to see what data is actually stored
SELECT 
  id,
  tipo_cliente,
  nome,
  cognome,
  sesso,
  email,
  telefono,
  ente_ufficio,
  denominazione,
  ragione_sociale
FROM customers_extended 
WHERE email = 'ophggrdd@orange.fr'  -- Replace with the email of the customer you're testing
LIMIT 5;

-- Check the most recently updated customer
SELECT 
  id,
  tipo_cliente,
  nome,
  cognome,
  sesso,
  email,
  updated_at
FROM customers_extended 
ORDER BY updated_at DESC NULLS LAST
LIMIT 5;
