-- Find duplicate customers by phone
SELECT 
  telefono,
  COUNT(*) as duplicate_count,
  STRING_AGG(id::text, ', ') as customer_ids,
  STRING_AGG(COALESCE(nome || ' ' || cognome, ragione_sociale, 'Unknown'), ' | ') as names,
  STRING_AGG(COALESCE(email, 'no email'), ' | ') as emails
FROM customers_extended
WHERE telefono IS NOT NULL AND telefono != ''
GROUP BY telefono
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 50;
