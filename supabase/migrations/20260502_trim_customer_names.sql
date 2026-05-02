-- ─────────────────────────────────────────────────────────────────────────
-- Cleanup: rimuove spazi leading/trailing dai campi nome/cognome/email/telefono
-- nei record clienti e prenotazioni. Risolve a monte il bug WhatsApp dove
-- "*Thomas *" non veniva renderizzato in grassetto.
--
-- Sicuro:
-- - tocca SOLO le righe in cui TRIM(x) <> x (idempotente: ri-eseguibile)
-- - NULL viene preservato (TRIM(NULL) = NULL)
-- - usa NULLIF per non sostituire una stringa vuota dopo il trim ('   ' → NULL)
-- ─────────────────────────────────────────────────────────────────────────

-- ─── PREVIEW: quante righe verranno toccate? ────────────────────────────
-- (puoi eseguire solo questa SELECT per vedere prima di applicare)
SELECT
    'customers_extended' AS tabella,
    SUM(CASE WHEN nome IS NOT NULL AND nome <> TRIM(nome) THEN 1 ELSE 0 END) AS nome_da_pulire,
    SUM(CASE WHEN cognome IS NOT NULL AND cognome <> TRIM(cognome) THEN 1 ELSE 0 END) AS cognome_da_pulire,
    SUM(CASE WHEN email IS NOT NULL AND email <> TRIM(email) THEN 1 ELSE 0 END) AS email_da_pulire,
    SUM(CASE WHEN telefono IS NOT NULL AND telefono <> TRIM(telefono) THEN 1 ELSE 0 END) AS telefono_da_pulire
FROM public.customers_extended
UNION ALL
SELECT
    'bookings',
    SUM(CASE WHEN customer_name IS NOT NULL AND customer_name <> TRIM(customer_name) THEN 1 ELSE 0 END),
    NULL,
    SUM(CASE WHEN customer_email IS NOT NULL AND customer_email <> TRIM(customer_email) THEN 1 ELSE 0 END),
    SUM(CASE WHEN customer_phone IS NOT NULL AND customer_phone <> TRIM(customer_phone) THEN 1 ELSE 0 END)
FROM public.bookings;

-- ─── CLEANUP customers_extended ─────────────────────────────────────────
UPDATE public.customers_extended
SET
    nome     = NULLIF(TRIM(nome), ''),
    cognome  = NULLIF(TRIM(cognome), ''),
    email    = NULLIF(TRIM(email), ''),
    telefono = NULLIF(TRIM(telefono), '')
WHERE
    (nome     IS NOT NULL AND nome     <> TRIM(nome))
 OR (cognome  IS NOT NULL AND cognome  <> TRIM(cognome))
 OR (email    IS NOT NULL AND email    <> TRIM(email))
 OR (telefono IS NOT NULL AND telefono <> TRIM(telefono));

-- ─── CLEANUP bookings (per evitare bold rotto nelle WhatsApp di prenotazione) ──
UPDATE public.bookings
SET
    customer_name  = NULLIF(TRIM(customer_name), ''),
    customer_email = NULLIF(TRIM(customer_email), ''),
    customer_phone = NULLIF(TRIM(customer_phone), '')
WHERE
    (customer_name  IS NOT NULL AND customer_name  <> TRIM(customer_name))
 OR (customer_email IS NOT NULL AND customer_email <> TRIM(customer_email))
 OR (customer_phone IS NOT NULL AND customer_phone <> TRIM(customer_phone));

-- ─── VERIFICA: dopo il cleanup tutti i conteggi devono essere 0 ─────────
SELECT
    'customers_extended dopo' AS tabella,
    SUM(CASE WHEN nome     IS NOT NULL AND nome     <> TRIM(nome)     THEN 1 ELSE 0 END) AS nome_residui,
    SUM(CASE WHEN cognome  IS NOT NULL AND cognome  <> TRIM(cognome)  THEN 1 ELSE 0 END) AS cognome_residui,
    SUM(CASE WHEN email    IS NOT NULL AND email    <> TRIM(email)    THEN 1 ELSE 0 END) AS email_residui,
    SUM(CASE WHEN telefono IS NOT NULL AND telefono <> TRIM(telefono) THEN 1 ELSE 0 END) AS telefono_residui
FROM public.customers_extended
UNION ALL
SELECT
    'bookings dopo',
    SUM(CASE WHEN customer_name  IS NOT NULL AND customer_name  <> TRIM(customer_name)  THEN 1 ELSE 0 END),
    NULL,
    SUM(CASE WHEN customer_email IS NOT NULL AND customer_email <> TRIM(customer_email) THEN 1 ELSE 0 END),
    SUM(CASE WHEN customer_phone IS NOT NULL AND customer_phone <> TRIM(customer_phone) THEN 1 ELSE 0 END)
FROM public.bookings;
