-- Get FULL customer data for these emails to see what's actually stored
SELECT 
    email,
    tipo_cliente,
    nome,
    cognome,
    codice_fiscale,
    data_nascita,
    luogo_nascita,
    indirizzo,
    citta,
    cap,
    provincia,
    telefono,
    sesso,
    numero_patente,
    tipo_patente,
    data_rilascio_patente,
    scadenza_patente
FROM customers_extended
WHERE email IN ('desmokelu@gmail.com', 'andrea.caria@dcrsrls.it');

-- Check if there are ANY customers with complete data
SELECT 
    COUNT(*) as total_customers,
    COUNT(nome) as have_nome,
    COUNT(cognome) as have_cognome,
    COUNT(codice_fiscale) as have_cf,
    COUNT(indirizzo) as have_address
FROM customers_extended
WHERE tipo_cliente = 'persona_fisica';
