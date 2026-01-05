-- Merge duplicate Alessandro Podda Pisanu records
-- This will combine the two records into one complete record

BEGIN;

-- First, let's find the two Alessandro Podda Pisanu records
SELECT 
  id,
  nome,
  cognome,
  email,
  telefono,
  tipo_cliente,
  codice_fiscale,
  created_at
FROM customers_extended
WHERE email = 'Alepisanu694@gmail.com'
ORDER BY created_at ASC;

-- Identify which record to keep (the oldest one, or the most complete)
-- We'll keep the one with tipo_cliente = 'persona_fisica' and merge data into it

DO $$
DECLARE
  primary_id UUID;
  duplicate_id UUID;
BEGIN
  -- Get the primary record (persona_fisica, most complete)
  SELECT id INTO primary_id
  FROM customers_extended
  WHERE email = 'Alepisanu694@gmail.com'
    AND tipo_cliente = 'persona_fisica'
  ORDER BY created_at ASC
  LIMIT 1;

  -- Get the duplicate record (the other one)
  SELECT id INTO duplicate_id
  FROM customers_extended
  WHERE email = 'Alepisanu694@gmail.com'
    AND id != primary_id
  LIMIT 1;

  RAISE NOTICE 'Primary ID: %', primary_id;
  RAISE NOTICE 'Duplicate ID: %', duplicate_id;

  -- Update the primary record with any missing data from the duplicate
  UPDATE customers_extended ce_primary
  SET 
    nome = COALESCE(ce_primary.nome, ce_dup.nome),
    cognome = COALESCE(ce_primary.cognome, ce_dup.cognome),
    codice_fiscale = COALESCE(ce_primary.codice_fiscale, ce_dup.codice_fiscale),
    telefono = COALESCE(ce_primary.telefono, ce_dup.telefono),
    email = COALESCE(ce_primary.email, ce_dup.email),
    indirizzo = COALESCE(ce_primary.indirizzo, ce_dup.indirizzo),
    citta_residenza = COALESCE(ce_primary.citta_residenza, ce_dup.citta_residenza),
    provincia_residenza = COALESCE(ce_primary.provincia_residenza, ce_dup.provincia_residenza),
    codice_postale = COALESCE(ce_primary.codice_postale, ce_dup.codice_postale),
    data_nascita = COALESCE(ce_primary.data_nascita, ce_dup.data_nascita),
    luogo_nascita = COALESCE(ce_primary.luogo_nascita, ce_dup.luogo_nascita),
    sesso = COALESCE(ce_primary.sesso, ce_dup.sesso),
    numero_patente = COALESCE(ce_primary.numero_patente, ce_dup.numero_patente),
    scadenza_patente = COALESCE(ce_primary.scadenza_patente, ce_dup.scadenza_patente),
    tipo_cliente = COALESCE(ce_primary.tipo_cliente, ce_dup.tipo_cliente),
    nazione = COALESCE(ce_primary.nazione, ce_dup.nazione),
    updated_at = NOW()
  FROM customers_extended ce_dup
  WHERE ce_primary.id = primary_id
    AND ce_dup.id = duplicate_id;

  -- Update all bookings to point to the primary record
  UPDATE bookings
  SET user_id = primary_id
  WHERE user_id = duplicate_id;

  RAISE NOTICE 'Updated % bookings', (SELECT COUNT(*) FROM bookings WHERE user_id = primary_id);

  -- Update customer_documents if any
  UPDATE customer_documents
  SET customer_id = primary_id
  WHERE customer_id = duplicate_id;

  -- Delete the duplicate record
  DELETE FROM customers_extended
  WHERE id = duplicate_id;

  RAISE NOTICE '✅ Successfully merged Alessandro Podda Pisanu records';
  RAISE NOTICE 'Kept record ID: %', primary_id;
  RAISE NOTICE 'Deleted record ID: %', duplicate_id;
END $$;

-- Verify the result
SELECT 
  id,
  nome,
  cognome,
  email,
  telefono,
  tipo_cliente,
  codice_fiscale,
  indirizzo,
  citta_residenza
FROM customers_extended
WHERE email = 'Alepisanu694@gmail.com';

COMMIT;

-- ✅ Merge complete!
