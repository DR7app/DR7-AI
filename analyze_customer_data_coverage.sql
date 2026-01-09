-- ============================================================================
-- CUSTOMER DATA COVERAGE ANALYSIS
-- ============================================================================
-- This script analyzes the customers_extended table to identify:
-- 1. Which fields are populated vs empty
-- 2. What data is stored in the metadata JSONB field
-- 3. Data completeness statistics
-- ============================================================================

-- 1. FIELD POPULATION STATISTICS
-- Shows how many customers have data in each field
SELECT 
    'Field Population Statistics' as report_section,
    COUNT(*) as total_customers,
    COUNT(nome) as has_nome,
    COUNT(cognome) as has_cognome,
    COUNT(email) as has_email,
    COUNT(telefono) as has_telefono,
    COUNT(codice_fiscale) as has_codice_fiscale,
    COUNT(partita_iva) as has_partita_iva,
    COUNT(indirizzo) as has_indirizzo,
    COUNT(codice_postale) as has_codice_postale,
    COUNT(citta) as has_citta,
    COUNT(provincia) as has_provincia,
    COUNT(nazione) as has_nazione,
    COUNT(data_nascita) as has_data_nascita,
    COUNT(luogo_nascita) as has_luogo_nascita,
    COUNT(numero_patente) as has_numero_patente,
    COUNT(categoria_patente) as has_categoria_patente,
    COUNT(data_rilascio) as has_data_rilascio,
    COUNT(data_scadenza) as has_data_scadenza,
    COUNT(ente_rilascio) as has_ente_rilascio,
    COUNT(pec) as has_pec,
    COUNT(denominazione) as has_denominazione,
    COUNT(ente_ufficio) as has_ente_ufficio,
    COUNT(codice_univoco) as has_codice_univoco,
    COUNT(CASE WHEN metadata IS NOT NULL AND metadata != '{}'::jsonb THEN 1 END) as has_metadata,
    COUNT(source) as has_source
FROM customers_extended;

-- 2. METADATA CONTENT ANALYSIS
-- Shows what keys are stored in the metadata JSONB field
SELECT 
    'Metadata Keys Analysis' as report_section,
    jsonb_object_keys(metadata) as metadata_key,
    COUNT(*) as occurrences
FROM customers_extended
WHERE metadata IS NOT NULL AND metadata != '{}'::jsonb
GROUP BY metadata_key
ORDER BY occurrences DESC;

-- 3. SAMPLE METADATA CONTENT
-- Shows actual metadata content for customers who have it
SELECT 
    'Sample Metadata Content' as report_section,
    id,
    COALESCE(nome || ' ' || cognome, denominazione, ente_ufficio) as customer_name,
    tipo_cliente,
    metadata,
    created_at
FROM customers_extended
WHERE metadata IS NOT NULL AND metadata != '{}'::jsonb
ORDER BY created_at DESC
LIMIT 10;

-- 4. CUSTOMERS BY TYPE
-- Breakdown by customer type
SELECT 
    'Customer Type Breakdown' as report_section,
    tipo_cliente,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM customers_extended), 2) as percentage
FROM customers_extended
GROUP BY tipo_cliente
ORDER BY count DESC;

-- 5. DATA COMPLETENESS BY CUSTOMER TYPE
-- Shows which fields are most complete for each customer type
SELECT 
    'Data Completeness by Type' as report_section,
    tipo_cliente,
    COUNT(*) as total,
    ROUND(COUNT(email) * 100.0 / COUNT(*), 2) as pct_has_email,
    ROUND(COUNT(telefono) * 100.0 / COUNT(*), 2) as pct_has_telefono,
    ROUND(COUNT(codice_fiscale) * 100.0 / COUNT(*), 2) as pct_has_codice_fiscale,
    ROUND(COUNT(indirizzo) * 100.0 / COUNT(*), 2) as pct_has_indirizzo,
    ROUND(COUNT(numero_patente) * 100.0 / COUNT(*), 2) as pct_has_patente,
    ROUND(COUNT(CASE WHEN metadata IS NOT NULL AND metadata != '{}'::jsonb THEN 1 END) * 100.0 / COUNT(*), 2) as pct_has_metadata
FROM customers_extended
GROUP BY tipo_cliente
ORDER BY total DESC;

-- 6. CUSTOMERS WITH MISSING CRITICAL DATA
-- Identifies customers missing essential information
SELECT 
    'Customers with Missing Critical Data' as report_section,
    id,
    COALESCE(nome || ' ' || cognome, denominazione, ente_ufficio, 'UNNAMED') as customer_name,
    tipo_cliente,
    CASE WHEN email IS NULL THEN 'Missing Email' ELSE '✓' END as email_status,
    CASE WHEN telefono IS NULL THEN 'Missing Phone' ELSE '✓' END as phone_status,
    CASE WHEN codice_fiscale IS NULL AND tipo_cliente = 'persona_fisica' THEN 'Missing CF' ELSE '✓' END as cf_status,
    CASE WHEN partita_iva IS NULL AND tipo_cliente = 'azienda' THEN 'Missing P.IVA' ELSE '✓' END as piva_status,
    CASE WHEN indirizzo IS NULL THEN 'Missing Address' ELSE '✓' END as address_status,
    created_at
FROM customers_extended
WHERE 
    email IS NULL 
    OR telefono IS NULL 
    OR (tipo_cliente = 'persona_fisica' AND codice_fiscale IS NULL)
    OR (tipo_cliente = 'azienda' AND partita_iva IS NULL)
    OR indirizzo IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- 7. SOURCE DISTRIBUTION
-- Shows where customers are coming from
SELECT 
    'Customer Source Distribution' as report_section,
    COALESCE(source, 'unknown') as source,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM customers_extended), 2) as percentage
FROM customers_extended
GROUP BY source
ORDER BY count DESC;

-- 8. RECENT CUSTOMERS WITH FULL DATA
-- Shows the most recently added customers and their data completeness
SELECT 
    'Recent Customers Data Snapshot' as report_section,
    id,
    tipo_cliente,
    COALESCE(nome || ' ' || cognome, denominazione, ente_ufficio) as customer_name,
    email,
    telefono,
    codice_fiscale,
    partita_iva,
    indirizzo,
    codice_postale,
    citta,
    numero_patente,
    CASE WHEN metadata IS NOT NULL AND metadata != '{}'::jsonb THEN 'Yes' ELSE 'No' END as has_metadata,
    source,
    created_at
FROM customers_extended
ORDER BY created_at DESC
LIMIT 15;
