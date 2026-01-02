-- Check the most recent invoice errors
SELECT 
  numero_fattura,
  customer_name,
  sdi_status,
  sdi_response,
  created_at
FROM fatture
WHERE sdi_status = 'error'
ORDER BY created_at DESC
LIMIT 5;
