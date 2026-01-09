-- Query to inspect user_documents table schema and sample data
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'user_documents'
ORDER BY ordinal_position;

-- Sample data from user_documents
SELECT * FROM user_documents LIMIT 5;

-- Check what customer data is available
SELECT 
    ud.id,
    ud.user_id,
    ud.document_type,
    ud.status,
    ud.upload_date,
    ce.nome,
    ce.cognome,
    ce.email,
    ce.telefono,
    ce.codice_fiscale,
    ce.data_nascita,
    ce.luogo_nascita,
    ce.indirizzo_residenza,
    ce.citta_residenza,
    ce.cap_residenza,
    ce.provincia_residenza
FROM user_documents ud
LEFT JOIN customers_extended ce ON ud.user_id = ce.id
LIMIT 5;
