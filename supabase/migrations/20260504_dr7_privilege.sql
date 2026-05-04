-- ============================================================
-- DR7 Privilege — codice sconto 10% post-pagamento, 15gg di scadenza
--
-- Trigger: cron Netlify (dr7-privilege-cron) che pesca i booking pagati
-- senza privilege ancora inviato e:
--   1. genera un codice DR7-PRIVILEGE-{INITIALS}-{4-RAND}
--   2. lo inserisce in discount_codes
--   3. manda WhatsApp con template da system_messages
--   4. stampa dr7_privilege_sent_at per idempotenza
--
-- Due template Pro: noleggio + lavaggio (chiavi pro_dr7_privilege_*).
-- ============================================================

-- Idempotency column: NULL = non ancora inviato
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS dr7_privilege_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS dr7_privilege_code text;

CREATE INDEX IF NOT EXISTS idx_bookings_dr7_privilege_pending
    ON public.bookings (payment_status, service_type)
    WHERE dr7_privilege_sent_at IS NULL;

-- Template seed: appaiono in Messaggi di Sistema Pro come righe editabili.
-- Usare ON CONFLICT (message_key) per non sovrascrivere modifiche admin.
INSERT INTO public.system_messages (message_key, label, message_body, is_enabled, include_header, description)
VALUES
    (
        'pro_dr7_privilege_noleggio',
        'DR7 Privilege — Post-Pagamento Noleggio',
        E'Gentile {nome},\n\nla sua prenotazione è ora ufficialmente confermata.\n\nCon DR7 non ha semplicemente noleggiato un veicolo: ha scelto di accedere a un’esperienza riservata, dove ogni dettaglio è progettato per distinguersi.\n\nPer ringraziarla della fiducia, abbiamo riservato per lei un vantaggio esclusivo:\n\ncodice personale {codice_supercar} DR7-PRIVILEGE 10% utilizzabile sul suo prossimo noleggio è valido 15gg.\n\nLe auguriamo un’esperienza che vada oltre la guida e resti nel tempo.\n\nRimaniamo a sua completa disposizione per qualsiasi necessità.\n\nDR7',
        true,
        false,
        'Inviato automaticamente quando una prenotazione noleggio viene marcata come pagata. Variabili: {nome}, {codice_supercar}.'
    ),
    (
        'pro_dr7_privilege_lavaggio',
        'DR7 Privilege — Post-Pagamento Lavaggio',
        E'Gentile {nome},\n\nil suo servizio è stato completato.\n\nCon DR7 non ha semplicemente effettuato un lavaggio: ha scelto uno standard superiore, dove cura, precisione e attenzione al dettaglio fanno la differenza.\n\nPer ringraziarla della fiducia, abbiamo riservato per lei un vantaggio esclusivo:\n\ncodice personale {codice_lavaggio} DR7-PRIVILEGE 10%, utilizzabile sul suo prossimo servizio e valido 15gg.\n\nCi auguriamo che il risultato sia all’altezza delle sue aspettative e restiamo a sua completa disposizione per ogni esigenza futura.\n\nDR7',
        true,
        false,
        'Inviato automaticamente quando un lavaggio viene marcato come pagato. Variabili: {nome}, {codice_lavaggio}.'
    )
ON CONFLICT (message_key) DO NOTHING;
