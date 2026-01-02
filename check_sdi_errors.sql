-- Query to check SDI errors in fatture table
SELECT 
    numero_fattura,
    customer_name,
    importo_totale,
    sdi_status,
    sdi_id,
    sdi_response,
    sdi_sent_at,
    created_at
FROM fatture
WHERE sdi_status = 'error' OR sdi_status IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- Check the most recent invoice with full details
SELECT *
FROM fatture
ORDER BY created_at DESC
LIMIT 1;
