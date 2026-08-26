-- =====================================================================
-- 26/08/2026 — Recupero nome, cognome e anagrafica degli iscritti al sito
-- =====================================================================
-- Perche' mancano: la registrazione salva TUTTO nei metadati auth, poi
-- aggiorna customers_extended con una sola UPDATE. Bastava un valore
-- rifiutato dal database (il CAP piu' lungo del campo, una data vuota, un
-- check) per far fallire l'INTERA update: nessun campo veniva scritto e la
-- scheda restava con la sola email, anche se il cliente aveva compilato
-- nome, cognome, codice fiscale, indirizzo e citta'.
--
-- Qui l'anagrafica viene rimessa a posto leggendola dai metadati auth, che
-- non si sono mai persi. Si scrive SOLO dove il campo e' vuoto: nessun dato
-- corretto viene sovrascritto.
--
-- Passo 1 = fotografia di quante schede verranno toccate (esegui e guarda).
-- Passo 2 = la scrittura vera.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASSO 1 — Quante schede sono incomplete e recuperabili
-- ---------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE ce.nome IS NULL OR ce.nome = '')                       AS senza_nome,
  count(*) FILTER (WHERE (ce.nome IS NULL OR ce.nome = '')
                     AND coalesce(au.raw_user_meta_data->>'nome',
                                  au.raw_user_meta_data->>'full_name',
                                  au.raw_user_meta_data->>'fullName',
                                  au.raw_user_meta_data->>'name') IS NOT NULL)  AS nome_recuperabile,
  count(*) FILTER (WHERE ce.codice_fiscale IS NULL OR ce.codice_fiscale = '')   AS senza_cf,
  count(*) FILTER (WHERE ce.indirizzo IS NULL OR ce.indirizzo = '')             AS senza_indirizzo,
  count(*)                                                                      AS schede_totali
FROM customers_extended ce
JOIN auth.users au ON au.id = ce.user_id;

-- ---------------------------------------------------------------------
-- PASSO 2 — Riempi solo i campi vuoti, dai metadati auth
-- ---------------------------------------------------------------------
WITH m AS (
  SELECT
    ce.id,
    -- nome: prima il campo esplicito, poi la prima parola del nome intero
    nullif(trim(coalesce(
      au.raw_user_meta_data->>'nome',
      split_part(trim(coalesce(au.raw_user_meta_data->>'full_name',
                               au.raw_user_meta_data->>'fullName',
                               au.raw_user_meta_data->>'name', '')), ' ', 1)
    )), '') AS nome,
    -- cognome: campo esplicito, altrimenti tutto cio' che segue la prima parola
    nullif(trim(coalesce(
      au.raw_user_meta_data->>'cognome',
      nullif(substring(trim(coalesce(au.raw_user_meta_data->>'full_name',
                                     au.raw_user_meta_data->>'fullName',
                                     au.raw_user_meta_data->>'name', ''))
                       from position(' ' in trim(coalesce(au.raw_user_meta_data->>'full_name',
                                                          au.raw_user_meta_data->>'fullName',
                                                          au.raw_user_meta_data->>'name', '')) ) + 1), '')
    )), '') AS cognome,
    nullif(trim(coalesce(au.raw_user_meta_data->>'telefono',
                         au.raw_user_meta_data->>'phone')), '')     AS telefono,
    nullif(trim(coalesce(au.raw_user_meta_data->>'codiceFiscale',
                         au.raw_user_meta_data->>'codice_fiscale')), '') AS codice_fiscale,
    nullif(trim(au.raw_user_meta_data->>'indirizzo'), '')           AS indirizzo,
    nullif(trim(coalesce(au.raw_user_meta_data->>'numeroCivico',
                         au.raw_user_meta_data->>'numero_civico')), '')  AS numero_civico,
    nullif(trim(coalesce(au.raw_user_meta_data->>'cittaResidenza',
                         au.raw_user_meta_data->>'citta_residenza')), '') AS citta_residenza,
    nullif(trim(coalesce(au.raw_user_meta_data->>'provinciaResidenza',
                         au.raw_user_meta_data->>'provincia_residenza')), '') AS provincia_residenza,
    nullif(trim(coalesce(au.raw_user_meta_data->>'codicePostale',
                         au.raw_user_meta_data->>'codice_postale')), '') AS codice_postale,
    nullif(trim(au.raw_user_meta_data->>'denominazione'), '')       AS denominazione,
    nullif(trim(coalesce(au.raw_user_meta_data->>'partitaIva',
                         au.raw_user_meta_data->>'partita_iva')), '')    AS partita_iva
  FROM customers_extended ce
  JOIN auth.users au ON au.id = ce.user_id
)
UPDATE customers_extended ce
SET
  nome                = coalesce(nullif(ce.nome, ''),                m.nome),
  cognome             = coalesce(nullif(ce.cognome, ''),             m.cognome),
  telefono            = coalesce(nullif(ce.telefono, ''),            m.telefono),
  codice_fiscale      = coalesce(nullif(ce.codice_fiscale, ''),      m.codice_fiscale),
  indirizzo           = coalesce(nullif(ce.indirizzo, ''),           m.indirizzo),
  numero_civico       = coalesce(nullif(ce.numero_civico, ''),       m.numero_civico),
  citta_residenza     = coalesce(nullif(ce.citta_residenza, ''),     m.citta_residenza),
  provincia_residenza = coalesce(nullif(ce.provincia_residenza, ''), m.provincia_residenza),
  codice_postale      = coalesce(nullif(ce.codice_postale, ''), left(m.codice_postale, 10)),
  denominazione       = coalesce(nullif(ce.denominazione, ''),       m.denominazione),
  partita_iva         = coalesce(nullif(ce.partita_iva, ''),         m.partita_iva),
  updated_at          = now()
FROM m
WHERE m.id = ce.id
  -- tocca solo le schede in cui almeno un campo vuoto viene davvero riempito
  AND (
       (nullif(ce.nome, '')                IS NULL AND m.nome                IS NOT NULL) OR
       (nullif(ce.cognome, '')             IS NULL AND m.cognome             IS NOT NULL) OR
       (nullif(ce.telefono, '')            IS NULL AND m.telefono            IS NOT NULL) OR
       (nullif(ce.codice_fiscale, '')      IS NULL AND m.codice_fiscale      IS NOT NULL) OR
       (nullif(ce.indirizzo, '')           IS NULL AND m.indirizzo           IS NOT NULL) OR
       (nullif(ce.numero_civico, '')       IS NULL AND m.numero_civico       IS NOT NULL) OR
       (nullif(ce.citta_residenza, '')     IS NULL AND m.citta_residenza     IS NOT NULL) OR
       (nullif(ce.provincia_residenza, '') IS NULL AND m.provincia_residenza IS NOT NULL) OR
       (nullif(ce.codice_postale, '')      IS NULL AND m.codice_postale      IS NOT NULL) OR
       (nullif(ce.denominazione, '')       IS NULL AND m.denominazione       IS NOT NULL) OR
       (nullif(ce.partita_iva, '')         IS NULL AND m.partita_iva         IS NOT NULL)
  );

-- ---------------------------------------------------------------------
-- PASSO 3 — Verifica: cosa resta senza nome dopo il recupero
-- ---------------------------------------------------------------------
SELECT ce.email, ce.tipo_cliente, ce.created_at
FROM customers_extended ce
JOIN auth.users au ON au.id = ce.user_id
WHERE (ce.nome IS NULL OR ce.nome = '')
  AND (ce.denominazione IS NULL OR ce.denominazione = '')
  AND (ce.ente_ufficio IS NULL OR ce.ente_ufficio = '')
ORDER BY ce.created_at DESC
LIMIT 50;
