
SELECT 
    id, 
    numero_fattura, 
    created_at, 
    sdi_status, 
    sdi_id, 
    sdi_response 
FROM fatture 
ORDER BY created_at DESC 
LIMIT 1;
