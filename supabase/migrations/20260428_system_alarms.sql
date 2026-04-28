-- ============================================================
-- system_alarms — admin-editable alarm configuration.
--
-- Replaces hardcoded thresholds in VehicleAlarmContext.tsx so admins
-- can toggle each alarm on/off and tweak its trigger threshold (e.g.
-- "ring 15 min before return" instead of the original 10 min) without
-- a code change.
--
-- ⚠ The TRIGGER LOGIC for each alarm.id stays in TypeScript — adding
-- a new id here without code changes leaves it inert. This table only
-- parameterises the existing 13 alarms.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_alarms (
    id              text PRIMARY KEY,                         -- alarm key (e.g. 'return_before')
    label           text NOT NULL,                            -- display name shown to admin
    schedule        text NOT NULL,                            -- human-readable schedule description
    reason          text NOT NULL,                            -- business reason (UI tooltip)
    category        text NOT NULL CHECK (category IN ('booking', 'fleet')),
    threshold_value numeric NOT NULL,                         -- 10, 1000, 7, etc.
    threshold_unit  text NOT NULL CHECK (threshold_unit IN ('minutes_before', 'minutes_after', 'km', 'days')),
    is_enabled      boolean NOT NULL DEFAULT true,
    sort_order      integer NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid                                      -- auth.uid() of last editor
);

CREATE INDEX IF NOT EXISTS idx_system_alarms_category ON public.system_alarms (category, sort_order);

-- ── RLS ───────────────────────────────────────────────────
ALTER TABLE public.system_alarms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read system_alarms" ON public.system_alarms;
CREATE POLICY "Admins can read system_alarms"
    ON public.system_alarms FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can write system_alarms" ON public.system_alarms;
CREATE POLICY "Admins can write system_alarms"
    ON public.system_alarms FOR ALL
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

-- ── Seed the 13 existing alarms ──────────────────────────
INSERT INTO public.system_alarms (id, label, schedule, reason, category, threshold_value, threshold_unit, is_enabled, sort_order) VALUES
    ('car_wash',           'Lavaggio in arrivo',                  '10 minuti prima dell''orario dell''appuntamento', 'Avvisa l''operatore di preparare la postazione lavaggio. Esclude i lavaggi interni / rientri.',                                  'booking',  10,    'minutes_before', true,  10),
    ('return_before',      'Promemoria Riconsegna',               '10 minuti prima della data di riconsegna',        'Avvisa che un veicolo a noleggio sta per rientrare: organizza check-in, controllo veicolo, pulizia.',                            'booking',  10,    'minutes_before', true,  20),
    ('return_after',       'Riconsegna in Ritardo',               '10 minuti dopo la data di riconsegna',            'Il cliente non ha riconsegnato in orario. Indipendente dall''avviso "prima": continua a suonare se l''admin non conferma rientro.', 'booking',  10,    'minutes_after',  true,  30),
    ('deposit',            'Cauzione da Incassare',               '10 minuti prima del ritiro',                      'Prenotazione con deposit > 0 in arrivo: serve incassare la cauzione al momento della consegna chiavi.',                          'booking',  10,    'minutes_before', true,  40),
    ('unpaid_pickup',      'Ritiro con Pagamento Aperto',         '10 minuti prima del ritiro',                      'Il cliente arriva tra poco ma il pagamento non è ancora segnato come paid/completed/succeeded. Da incassare.',                   'booking',  10,    'minutes_before', true,  50),
    ('fleet_service',      'Tagliando in Scadenza',               'Quando mancano ≤ 1.000 km al prossimo tagliando', 'Il veicolo si avvicina al chilometraggio del tagliando programmato (last_service_km + intervallo).',                             'fleet',    1000,  'km',             true,  110),
    ('fleet_tires_front',  'Gomme Anteriori in Scadenza',         'Quando mancano ≤ 1.000 km al cambio anteriori',   'Soglia di sicurezza per programmare in tempo il cambio gomme anteriori.',                                                        'fleet',    1000,  'km',             true,  120),
    ('fleet_tires_rear',   'Gomme Posteriori in Scadenza',        'Quando mancano ≤ 1.000 km al cambio posteriori',  'Soglia di sicurezza per programmare in tempo il cambio gomme posteriori.',                                                       'fleet',    1000,  'km',             true,  130),
    ('fleet_brakes_front', 'Pastiglie Anteriori in Scadenza',     'Quando mancano ≤ 1.000 km al cambio anteriori',   'Programma il cambio pastiglie freni anteriori prima del consumo critico.',                                                       'fleet',    1000,  'km',             true,  140),
    ('fleet_brakes_rear',  'Pastiglie Posteriori in Scadenza',    'Quando mancano ≤ 1.000 km al cambio posteriori',  'Programma il cambio pastiglie freni posteriori prima del consumo critico.',                                                      'fleet',    1000,  'km',             true,  150),
    ('fleet_insurance',    'Assicurazione in Scadenza',           'Quando mancano ≤ 7 giorni alla scadenza',         'Veicolo non può circolare senza copertura RC: serve rinnovare in tempo.',                                                        'fleet',    7,     'days',           true,  160),
    ('fleet_tax',          'Bollo in Scadenza',                   'Quando mancano ≤ 7 giorni alla scadenza',         'Sanzione amministrativa se non versato entro la scadenza.',                                                                      'fleet',    7,     'days',           true,  170),
    ('fleet_inspection',   'Revisione in Scadenza',               'Quando mancano ≤ 7 giorni alla revisione',        'Veicolo non revisionato non è abilitato alla circolazione né noleggiabile.',                                                     'fleet',    7,     'days',           true,  180)
ON CONFLICT (id) DO NOTHING;
