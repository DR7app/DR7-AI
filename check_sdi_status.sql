-- Check the latest invoice SDI status and error
SELECT 
  numero_fattura,
  customer_name,
  sdi_status,
  sdi_id,
  sdi_sent_at,
  sdi_response,
  created_at
FROM fatture
ORDER BY created_at DESC
LIMIT 3;
