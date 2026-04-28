-- ============================================================
-- system_otp_overrides — admin-editable OTP-gating policy.
--
-- Catalogues every limitation code that triggers an OTP override
-- modal (sent via WhatsApp to valesaja91@icloud.com per memory).
-- When is_required = false, the limitation is silently auto-approved
-- by the frontend hook so admins can bypass the OTP gate where the
-- business has decided it's no longer needed.
--
-- ⚠ The trigger logic (which conditions raise which code) stays in
-- TypeScript. Only the GATE on each code is moved to the DB.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_otp_overrides (
    id          text PRIMARY KEY,                                       -- limitation code (e.g. 'license_too_recent')
    label       text NOT NULL,                                          -- display name in Gestione OTP tab
    reason      text NOT NULL,                                          -- why this OTP gate exists
    used_in     text NOT NULL,                                          -- where it fires ("Booking form", "Preventivo", etc.)
    is_required boolean NOT NULL DEFAULT true,                          -- false → bypass OTP, auto-approve
    sort_order  integer NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid
);

CREATE INDEX IF NOT EXISTS idx_system_otp_overrides_order
    ON public.system_otp_overrides (sort_order);

-- ── RLS ───────────────────────────────────────────────────
ALTER TABLE public.system_otp_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read system_otp_overrides" ON public.system_otp_overrides;
CREATE POLICY "Admins can read system_otp_overrides"
    ON public.system_otp_overrides FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can write system_otp_overrides" ON public.system_otp_overrides;
CREATE POLICY "Admins can write system_otp_overrides"
    ON public.system_otp_overrides FOR ALL
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

-- ── Seed every limitation code currently raised in the codebase ────
INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order) VALUES
    ('driver_blocked',          'Cliente Non Idoneo (Fascia BLOCKED)',  'Cliente sotto i 21 anni, sopra i 69, o con patente meno di 3 anni: non può noleggiare. Override richiede approvazione direttore.',                                  'Prenotazione (creazione + edit)',                  true, 10),
    ('license_expired',         'Patente Scaduta',                       'La patente del cliente risulta scaduta — richiede autorizzazione per procedere comunque al noleggio.',                                                           'Prenotazione (creazione + edit)',                  true, 20),
    ('license_too_recent',      'Patente Recente (< 3 anni)',           'Patente rilasciata da meno di 3 anni: cliente non idoneo per default. Override richiede approvazione direttore.',                                            'Prenotazione (creazione + edit)',                  true, 30),
    ('tier1_no_cauzione',       'No Cauzione per Fascia B',              'Fascia B (età 21-25 o patente 3-4 anni) ha rischio elevato: la formula "No Cauzione" è normalmente bloccata. Override per casi eccezionali.',                'Prenotazione + Preventivo',                        true, 40),
    ('no_cauzione_rca_only',    'No Cauzione senza Kasko',               'La formula No Cauzione richiede una Kasko attiva. Selezione di RCA + No Cauzione è un’eccezione che richiede autorizzazione.',                       'Prenotazione + Preventivo',                        true, 50),
    ('vehicle_year_too_old',    'Veicolo Cauzione Pre-2020',             'I veicoli usati come cauzione devono essere immatricolati dal 2020 in poi. Veicolo più vecchio richiede autorizzazione.',                                'Prenotazione (modulo cauzione)',                   true, 60),
    ('pickup_in_past',          'Ritiro nel Passato',                    'L’orario di ritiro è già passato. Inserire una data passata richiede autorizzazione (di solito è un errore).',                                              'Prenotazione (creazione)',                         true, 70),
    ('slot_unavailable',        'Slot Non Disponibile',                  'Il veicolo è già prenotato in quel range orario o è in conflitto con un’altra prenotazione (buffer 75 min). Override per sovra-prenotazione consapevole.', 'Prenotazione + Preventivo',                       true, 80),
    ('manual_category_carwash', 'Categoria Lavaggio Manuale',            'Targa non trovata nel database veicoli durante creazione lavaggio: serve autorizzazione per scegliere manualmente la categoria.',                              'Prime Wash (creazione lavaggio)',                  true, 90),
    ('signature_otp',           'OTP Firma Contratto Cliente',           'Il cliente firma il contratto via WhatsApp inserendo un codice OTP. Disattivando, la firma diventa solo cliccabile (meno sicurezza legale).',           'Trustera signing flow (server-side)',              true, 100)
ON CONFLICT (id) DO NOTHING;
