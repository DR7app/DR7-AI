-- Quick check for Riccardo Pilia in customers_extended
SELECT 
    id,
    tipo_cliente,
    nome,
    cognome,
    email,
    telefono,
    codice_fiscale,
    created_at
FROM customers_extended
WHERE 
    LOWER(nome) LIKE '%riccardo%' 
    AND LOWER(cognome) LIKE '%pilia%'
LIMIT 5;
