-- Find duplicate customers by email
SELECT 
  email,
  COUNT(*) as duplicate_count,
  STRING_AGG(id::text, ', ') as customer_ids,
  STRING_AGG(COALESCE(nome || ' ' || cognome, ragione_sociale, 'Unknown'), ' | ') as names,
  STRING_AGG(COALESCE(source, 'unknown'), ' | ') as sources
FROM customers_extended
WHERE email IS NOT NULL AND email != ''
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 50;
