-- Before sending the next azienda fattura, paste the customer's name or
-- email below and verify tipo_cliente + partita_iva are set. If either
-- is wrong, SDI will reject the fattura (CF used instead of P.IVA, or
-- driver's name used instead of ragione_sociale).
--
-- Edit the WHERE filter to point at your customer.

SELECT
  id,
  tipo_cliente,                 -- DEVE essere 'azienda' o 'pubblica_amministrazione'
  ragione_sociale,              -- nome dell'azienda
  denominazione,                -- fallback
  partita_iva,                  -- P.IVA, formato 11 cifre
  codice_fiscale,               -- CF, opzionale per azienda
  codice_destinatario,          -- 7 char SDI code, oppure '0000000'
  pec,                          -- PEC azienda
  sede_legale,                  -- via, città, cap
  nome,                         -- nome PERSONA (driver) — NON usato per la fattura azienda
  cognome,                      -- cognome PERSONA — NON usato per fattura azienda
  email
FROM public.customers_extended
WHERE LOWER(ragione_sociale) LIKE '%CAMBIA_QUI%'
   OR LOWER(denominazione)   LIKE '%CAMBIA_QUI%'
   OR LOWER(email)           LIKE '%CAMBIA_QUI%';
