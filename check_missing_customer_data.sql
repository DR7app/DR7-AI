-- Check customers with missing data
SELECT 
  id,
  tipo_cliente,
  nome,
  cognome,
  denominazione,
  ente_ufficio,
  email,
  telefono,
  codice_fiscale,
  data_nascita,
  luogo_nascita,
  indirizzo,
  citta_residenza,
  citta,
  patente,
  partita_iva,
  CASE 
    WHEN tipo_cliente = 'persona_fisica' THEN
      CASE 
        WHEN nome IS NULL THEN 'Missing: nome'
        WHEN cognome IS NULL THEN 'Missing: cognome'
        WHEN codice_fiscale IS NULL THEN 'Missing: codice_fiscale'
        WHEN data_nascita IS NULL THEN 'Missing: data_nascita'
        WHEN luogo_nascita IS NULL THEN 'Missing: luogo_nascita'
        WHEN indirizzo IS NULL THEN 'Missing: indirizzo'
        WHEN citta_residenza IS NULL AND citta IS NULL THEN 'Missing: citta_residenza'
        WHEN patente IS NULL THEN 'Missing: patente'
        WHEN email IS NULL THEN 'Missing: email'
        WHEN telefono IS NULL THEN 'Missing: telefono'
        ELSE 'Complete'
      END
    WHEN tipo_cliente = 'azienda' THEN
      CASE 
        WHEN denominazione IS NULL THEN 'Missing: denominazione'
        WHEN partita_iva IS NULL THEN 'Missing: partita_iva'
        WHEN indirizzo IS NULL THEN 'Missing: indirizzo'
        WHEN email IS NULL THEN 'Missing: email'
        WHEN telefono IS NULL THEN 'Missing: telefono'
        ELSE 'Complete'
      END
    ELSE 'Unknown type'
  END as status
FROM customers_extended
ORDER BY created_at DESC
LIMIT 20;
