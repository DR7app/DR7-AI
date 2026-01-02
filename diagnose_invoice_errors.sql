-- Check if customers have required tax information
SELECT 
  f.numero_fattura,
  f.customer_name,
  f.customer_tax_code,
  f.customer_vat,
  f.customer_address,
  f.sdi_status,
  f.sdi_response-\u003e\u003e'error' as error_message,
  f.sdi_response-\u003e\u003e'message' as api_message
FROM fatture f
WHERE f.numero_fattura IN ('DR7-2025-0023', 'DR7-2025-0022', 'DR7-2025-0021', 'DR7-2025-0020')
ORDER BY f.created_at DESC;
