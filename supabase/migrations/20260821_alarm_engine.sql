-- ============================================================
-- Motore allarmi DR7 — catalogo completo + storico risoluzioni.
--
-- 2026-08-21 (richiesta direzione). Prima: 13 allarmi, accesi/spenti e con
-- una soglia. Nessuna priorita', nessun reparto, nessun ON/OFF sulla singola
-- pratica, nessuna ripetizione, nessuna notifica oltre al popup, e soprattutto
-- nessuno storico: il "Posticipa" viveva nel localStorage del browser e il
-- "Risolto" era un timestamp sulla prenotazione, senza sapere CHI.
--
-- Questa migration aggiunge:
--   1. le colonne che mancavano a system_alarms (priorita', reparto, canali,
--      ripetizione, stato di rilevamento, gruppo del catalogo);
--   2. alarm_events  — una riga per OCCORRENZA: quando e' scattato, su quale
--      pratica, chi l'ha risolto o posticipato e quando;
--   3. alarm_overrides — acceso/spento sulla SINGOLA pratica o veicolo;
--   4. il catalogo completo: 19 gruppi, tutte le voci chieste dalla direzione.
--
-- Le 13 righe storiche NON vengono toccate nei valori: prendono solo il
-- gruppo del catalogo. Le voci del catalogo che erano lo stesso allarme
-- riusano il loro id, cosi' non nascono doppioni che suonano due volte.
--
-- ATTENZIONE: una riga senza `detector` e' visibile e configurabile ma non
-- puo' suonare — la rilevazione e' codice. Lo stato e' scritto nella colonna
-- stato_rilevamento e mostrato nel gestionale.
-- ============================================================

-- ── 1. system_alarms: le colonne che mancavano ────────────────
ALTER TABLE public.system_alarms
  ADD COLUMN IF NOT EXISTS group_key                 text,
  ADD COLUMN IF NOT EXISTS priority                  text NOT NULL DEFAULT 'attenzione',
  ADD COLUMN IF NOT EXISTS reparto                   text,
  ADD COLUMN IF NOT EXISTS detector                  text,
  ADD COLUMN IF NOT EXISTS stato_rilevamento         text NOT NULL DEFAULT 'in_attesa',
  ADD COLUMN IF NOT EXISTS ripeti_finche_non_risolto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ripeti_ogni_minuti        integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS notifica_gestionale       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notifica_push             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notifica_whatsapp_interna boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notifica_email_interna    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS destinatari               jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.system_alarms DROP CONSTRAINT IF EXISTS system_alarms_priority_check;
ALTER TABLE public.system_alarms ADD CONSTRAINT system_alarms_priority_check
  CHECK (priority IN ('informativo', 'attenzione', 'urgente', 'bloccante'));

ALTER TABLE public.system_alarms DROP CONSTRAINT IF EXISTS system_alarms_stato_rilevamento_check;
ALTER TABLE public.system_alarms ADD CONSTRAINT system_alarms_stato_rilevamento_check
  CHECK (stato_rilevamento IN ('attivo', 'in_attesa'));

COMMENT ON COLUMN public.system_alarms.detector IS
  'Chiave della funzione di rilevazione (src/utils/alarmDetectors.ts). NULL = nessuna rilevazione: la riga non puo'' suonare.';
COMMENT ON COLUMN public.system_alarms.destinatari IS
  'Elenco destinatari per WhatsApp/email interna: [{"nome":"...","telefono":"...","email":"..."}].';

CREATE INDEX IF NOT EXISTS idx_system_alarms_group ON public.system_alarms (group_key, sort_order);

-- ── 2. alarm_events: una riga per occorrenza + storico ────────
CREATE TABLE IF NOT EXISTS public.alarm_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alarm_id         text NOT NULL REFERENCES public.system_alarms(id) ON DELETE CASCADE,
    booking_id       uuid,
    vehicle_id       uuid,
    -- Copia leggibile al momento dello scatto: se la prenotazione viene
    -- cancellata lo storico resta comprensibile.
    entita           text,
    priority         text NOT NULL DEFAULT 'attenzione',
    stato            text NOT NULL DEFAULT 'aperto',
    triggered_at     timestamptz NOT NULL DEFAULT now(),
    -- Quante volte questo stesso allarme e' tornato a suonare senza essere
    -- risolto: e' la ripetizione, non un nuovo evento.
    ripetizioni      integer NOT NULL DEFAULT 0,
    ultima_notifica  timestamptz,
    posticipato_a    timestamptz,
    posticipato_da   uuid,
    risolto_at       timestamptz,
    risolto_da       uuid,
    risolto_da_nome  text,
    nota             text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alarm_events DROP CONSTRAINT IF EXISTS alarm_events_stato_check;
ALTER TABLE public.alarm_events ADD CONSTRAINT alarm_events_stato_check
  CHECK (stato IN ('aperto', 'posticipato', 'risolto'));

-- Un solo evento APERTO per (allarme, pratica): il secondo giro non crea una
-- riga nuova, incrementa `ripetizioni`. Senza questo, un allarme non risolto
-- genererebbe una riga al minuto.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_alarm_event_aperto_booking
  ON public.alarm_events (alarm_id, booking_id)
  WHERE stato <> 'risolto' AND booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_alarm_event_aperto_vehicle
  ON public.alarm_events (alarm_id, vehicle_id)
  WHERE stato <> 'risolto' AND vehicle_id IS NOT NULL AND booking_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_alarm_events_aperti ON public.alarm_events (stato, priority, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_events_booking ON public.alarm_events (booking_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_events_vehicle ON public.alarm_events (vehicle_id, triggered_at DESC);

ALTER TABLE public.alarm_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read alarm_events" ON public.alarm_events;
CREATE POLICY "Admins can read alarm_events" ON public.alarm_events FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins can write alarm_events" ON public.alarm_events;
CREATE POLICY "Admins can write alarm_events" ON public.alarm_events FOR ALL
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

-- ── 3. alarm_overrides: ON/OFF sulla singola pratica ──────────
CREATE TABLE IF NOT EXISTS public.alarm_overrides (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alarm_id    text NOT NULL REFERENCES public.system_alarms(id) ON DELETE CASCADE,
    booking_id  uuid,
    vehicle_id  uuid,
    is_enabled  boolean NOT NULL DEFAULT false,
    motivo      text,
    updated_by  uuid,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alarm_overrides_target_check CHECK (booking_id IS NOT NULL OR vehicle_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_alarm_override_booking
  ON public.alarm_overrides (alarm_id, booking_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_alarm_override_vehicle
  ON public.alarm_overrides (alarm_id, vehicle_id) WHERE vehicle_id IS NOT NULL AND booking_id IS NULL;

ALTER TABLE public.alarm_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read alarm_overrides" ON public.alarm_overrides;
CREATE POLICY "Admins can read alarm_overrides" ON public.alarm_overrides FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins can write alarm_overrides" ON public.alarm_overrides;
CREATE POLICY "Admins can write alarm_overrides" ON public.alarm_overrides FOR ALL
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

-- ── 4. Le 13 righe storiche entrano nel catalogo ──────────────
-- Solo il gruppo e il detector: soglie, label e suoni restano quelli che
-- l'operatore ha gia' scelto.
UPDATE public.system_alarms SET group_key = v.grp, detector = v.det, stato_rilevamento = 'attivo'
FROM (VALUES
  ('car_wash','lavaggi','legacy_car_wash'),
  ('return_before','riconsegna','legacy_return_before'),
  ('return_after','riconsegna','legacy_return_after'),
  ('deposit','cauzione','legacy_deposit'),
  ('unpaid_pickup','pagamenti','legacy_unpaid_pickup'),
  ('fleet_service','manutenzione','legacy_fleet_km'),
  ('fleet_tires_front','pneumatici','legacy_fleet_km'),
  ('fleet_tires_rear','pneumatici','legacy_fleet_km'),
  ('fleet_brakes_front','manutenzione','legacy_fleet_km'),
  ('fleet_brakes_rear','manutenzione','legacy_fleet_km'),
  ('fleet_insurance','scadenze','legacy_fleet_date'),
  ('fleet_tax','scadenze','legacy_fleet_date'),
  ('fleet_inspection','scadenze','legacy_fleet_date')
) AS v(id, grp, det)
WHERE public.system_alarms.id = v.id;

-- cauzione_scadenza_rimborso esiste gia' (migration 20260723) ma non ha gruppo.
UPDATE public.system_alarms SET group_key = 'cauzione', stato_rilevamento = 'attivo',
       detector = COALESCE(detector, 'legacy_cauzione_scadenza')
WHERE id = 'cauzione_scadenza_rimborso' AND group_key IS NULL;

-- ── 5. Il catalogo ────────────────────────────────────────────
-- ON CONFLICT DO NOTHING: quello che la direzione ha gia' configurato non
-- viene mai sovrascritto da una riesecuzione della migration.
INSERT INTO public.system_alarms
  (id, label, schedule, reason, category, group_key, priority, reparto,
   threshold_value, threshold_unit, is_enabled, stato_rilevamento, sort_order)
VALUES
  ('rit_ritiro_cliente_arrivo', 'Ritiro cliente in arrivo', '120 minuti prima', 'Ritiro cliente in arrivo — reparto Front Office.', 'booking', 'ritiro', 'informativo', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 10),
  ('rit_ritiro_tra_60_minuti', 'Ritiro tra 60 minuti', '60 minuti prima', 'Ritiro tra 60 minuti — reparto Front Office.', 'booking', 'ritiro', 'informativo', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 20),
  ('rit_ritiro_tra_30_minuti', 'Ritiro tra 30 minuti', '30 minuti prima', 'Ritiro tra 30 minuti — reparto Front Office.', 'booking', 'ritiro', 'informativo', 'Front Office', 30, 'minutes_before', true, 'in_attesa', 30),
  ('rit_ritiro_tra_10_minuti', 'Ritiro tra 10 minuti', '10 minuti prima', 'Ritiro tra 10 minuti — reparto Front Office.', 'booking', 'ritiro', 'informativo', 'Front Office', 10, 'minutes_before', true, 'in_attesa', 40),
  ('rit_orario_ritiro_raggiunto', 'Orario di ritiro raggiunto', 'Appena la condizione si verifica', 'Orario di ritiro raggiunto — reparto Front Office.', 'booking', 'ritiro', 'urgente', 'Front Office', 0, 'minutes_after', true, 'in_attesa', 50),
  ('rit_cliente_non_ancora_arrivato', 'Cliente non ancora arrivato', '15 minuti dopo', 'Cliente non ancora arrivato — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 15, 'minutes_after', true, 'in_attesa', 60),
  ('rit_veicolo_non_segnato_come_pronto', 'Veicolo non segnato come pronto', '120 minuti prima', 'Veicolo non segnato come pronto — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 70),
  ('rit_veicolo_non_presente_sede', 'Veicolo non presente in sede', '120 minuti prima', 'Veicolo non presente in sede — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 80),
  ('rit_veicolo_ancora_associato_noleggio_precedente', 'Veicolo ancora associato al noleggio precedente', '120 minuti prima', 'Veicolo ancora associato al noleggio precedente — reparto Front Office.', 'booking', 'ritiro', 'informativo', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 90),
  ('rit_veicolo_precedente_non_ancora_riconsegnato', 'Veicolo precedente non ancora riconsegnato', '120 minuti prima', 'Veicolo precedente non ancora riconsegnato — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 100),
  ('rit_lavaggio_veicolo_non_completato', 'Lavaggio veicolo non completato', '120 minuti prima', 'Lavaggio veicolo non completato — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 110),
  ('rit_check_pre_consegna_non_completato', 'Check pre-consegna non completato', '120 minuti prima', 'Check pre-consegna non completato — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 120),
  ('rit_foto_pre_consegna_mancanti', 'Foto pre-consegna mancanti', '120 minuti prima', 'Foto pre-consegna mancanti — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 130),
  ('rit_video_pre_consegna_mancante', 'Video pre-consegna mancante', '120 minuti prima', 'Video pre-consegna mancante — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 140),
  ('rit_chilometraggio_iniziale_non_registrato', 'Chilometraggio iniziale non registrato', '120 minuti prima', 'Chilometraggio iniziale non registrato — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 150),
  ('rit_livello_carburante_iniziale_non_registrato', 'Livello carburante iniziale non registrato', '120 minuti prima', 'Livello carburante iniziale non registrato — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 160),
  ('rit_operatore_consegna_non_assegnato', 'Operatore consegna non assegnato', '120 minuti prima', 'Operatore consegna non assegnato — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 170),
  ('rit_consegna_fuori_sede_organizzare', 'Consegna fuori sede da organizzare', '120 minuti prima', 'Consegna fuori sede da organizzare — reparto Front Office.', 'booking', 'ritiro', 'informativo', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 180),
  ('rit_autista_consegna_non_assegnato', 'Autista per consegna non assegnato', '120 minuti prima', 'Autista per consegna non assegnato — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 190),
  ('rit_indirizzo_consegna_mancante', 'Indirizzo consegna mancante', '120 minuti prima', 'Indirizzo consegna mancante — reparto Front Office.', 'booking', 'ritiro', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 200),
  ('con_contratto_non_generato', 'Contratto non generato', '120 minuti prima', 'Contratto non generato — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 210),
  ('con_contratto_generato_non_inviato', 'Contratto generato ma non inviato', '120 minuti prima', 'Contratto generato ma non inviato — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 220),
  ('con_contratto_inviato_non_aperto', 'Contratto inviato ma non aperto', '120 minuti prima', 'Contratto inviato ma non aperto — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 230),
  ('con_contratto_aperto_non_firmato', 'Contratto aperto ma non firmato', '120 minuti prima', 'Contratto aperto ma non firmato — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 240),
  ('con_contratto_non_firmato_60_minuti_dal_ritiro', 'Contratto non firmato a 60 minuti dal ritiro', '60 minuti prima', 'Contratto non firmato a 60 minuti dal ritiro — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 60, 'minutes_before', true, 'in_attesa', 250),
  ('con_contratto_non_firmato_30_minuti_dal_ritiro', 'Contratto non firmato a 30 minuti dal ritiro', '30 minuti prima', 'Contratto non firmato a 30 minuti dal ritiro — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 30, 'minutes_before', true, 'in_attesa', 260),
  ('con_contratto_non_firmato_10_minuti_dal_ritiro', 'Contratto non firmato a 10 minuti dal ritiro', '10 minuti prima', 'Contratto non firmato a 10 minuti dal ritiro — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 10, 'minutes_before', true, 'in_attesa', 270),
  ('con_orario_ritiro_raggiunto_contratto_non_firmato', 'ORARIO RITIRO RAGGIUNTO — CONTRATTO NON FIRMATO', 'Appena la condizione si verifica', 'ORARIO RITIRO RAGGIUNTO — CONTRATTO NON FIRMATO — reparto Amministrazione.', 'booking', 'contratto', 'bloccante', 'Amministrazione', 0, 'minutes_after', true, 'in_attesa', 280),
  ('con_firma_cliente_incompleta', 'Firma cliente incompleta', '120 minuti prima', 'Firma cliente incompleta — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 290),
  ('con_firma_secondo_conducente_mancante', 'Firma secondo conducente mancante', '120 minuti prima', 'Firma secondo conducente mancante — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 300),
  ('con_contratto_dati_mancanti', 'Contratto con dati mancanti', '120 minuti prima', 'Contratto con dati mancanti — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 310),
  ('con_contratto_modificato_dopo_firma', 'Contratto modificato dopo la firma', '120 minuti prima', 'Contratto modificato dopo la firma — reparto Amministrazione.', 'booking', 'contratto', 'informativo', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 320),
  ('con_contratto_rigenerare', 'Contratto da rigenerare', '120 minuti prima', 'Contratto da rigenerare — reparto Amministrazione.', 'booking', 'contratto', 'informativo', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 330),
  ('con_allegato_contrattuale_mancante', 'Allegato contrattuale mancante', '120 minuti prima', 'Allegato contrattuale mancante — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 340),
  ('con_consenso_privacy_mancante', 'Consenso/privacy mancante', '120 minuti prima', 'Consenso/privacy mancante — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 350),
  ('con_condizioni_specifiche_non_accettate', 'Condizioni specifiche non accettate', '120 minuti prima', 'Condizioni specifiche non accettate — reparto Amministrazione.', 'booking', 'contratto', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 360),
  ('doc_carta_d_identita_mancante', 'Carta d''identita'' mancante', '120 minuti prima', 'Carta d''identita'' mancante — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 370),
  ('doc_patente_mancante', 'Patente mancante', '120 minuti prima', 'Patente mancante — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 380),
  ('doc_fronte_documento_mancante', 'Fronte documento mancante', '120 minuti prima', 'Fronte documento mancante — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 390),
  ('doc_retro_documento_mancante', 'Retro documento mancante', '120 minuti prima', 'Retro documento mancante — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 400),
  ('doc_documento_illeggibile', 'Documento illeggibile', '120 minuti prima', 'Documento illeggibile — reparto Front Office.', 'booking', 'documenti', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 410),
  ('doc_documento_scaduto', 'Documento scaduto', '120 minuti prima', 'Documento scaduto — reparto Front Office.', 'booking', 'documenti', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 420),
  ('doc_documento_scadenza', 'Documento in scadenza', '7 giorni prima', 'Documento in scadenza — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 7, 'days', true, 'in_attesa', 430),
  ('doc_patente_scaduta', 'Patente scaduta', '120 minuti prima', 'Patente scaduta — reparto Front Office.', 'booking', 'documenti', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 440),
  ('doc_patente_scadenza', 'Patente in scadenza', '7 giorni prima', 'Patente in scadenza — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 7, 'days', true, 'in_attesa', 450),
  ('doc_patente_non_compatibile_veicolo', 'Patente non compatibile con il veicolo', '120 minuti prima', 'Patente non compatibile con il veicolo — reparto Front Office.', 'booking', 'documenti', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 460),
  ('doc_anzianita_patente_insufficiente', 'Anzianita'' patente insufficiente', '120 minuti prima', 'Anzianita'' patente insufficiente — reparto Front Office.', 'booking', 'documenti', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 470),
  ('doc_eta_conducente_non_compatibile', 'Eta'' conducente non compatibile', '120 minuti prima', 'Eta'' conducente non compatibile — reparto Front Office.', 'booking', 'documenti', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 480),
  ('doc_secondo_conducente_senza_documenti', 'Secondo conducente senza documenti', '120 minuti prima', 'Secondo conducente senza documenti — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 490),
  ('doc_dati_cliente_incompleti', 'Dati cliente incompleti', '120 minuti prima', 'Dati cliente incompleti — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 500),
  ('doc_codice_fiscale_mancante', 'Codice fiscale mancante', '120 minuti prima', 'Codice fiscale mancante — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 510),
  ('doc_indirizzo_residenza_mancante', 'Indirizzo di residenza mancante', '120 minuti prima', 'Indirizzo di residenza mancante — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 520),
  ('doc_email_mancante', 'Email mancante', '120 minuti prima', 'Email mancante — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 530),
  ('doc_numero_telefonico_mancante', 'Numero telefonico mancante', '120 minuti prima', 'Numero telefonico mancante — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 540),
  ('doc_verifica_documentale_non_completata', 'Verifica documentale non completata', '120 minuti prima', 'Verifica documentale non completata — reparto Front Office.', 'booking', 'documenti', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 550),
  ('doc_cliente_pratica_ancora_approvare', 'Cliente/pratica ancora da approvare', '120 minuti prima', 'Cliente/pratica ancora da approvare — reparto Front Office.', 'booking', 'documenti', 'informativo', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 560),
  ('pag_noleggio_non_pagato', 'Noleggio non pagato', '120 minuti prima', 'Noleggio non pagato — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 570),
  ('pag_noleggio_parzialmente_pagato', 'Noleggio parzialmente pagato', '120 minuti prima', 'Noleggio parzialmente pagato — reparto Amministrazione.', 'booking', 'pagamenti', 'informativo', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 580),
  ('pag_saldo_residuo_presente', 'Saldo residuo presente', '120 minuti prima', 'Saldo residuo presente — reparto Amministrazione.', 'booking', 'pagamenti', 'informativo', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 590),
  ('pag_pagamento_scadenza', 'Pagamento in scadenza', '7 giorni prima', 'Pagamento in scadenza — reparto Amministrazione.', 'booking', 'pagamenti', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 600),
  ('pag_orario_ritiro_raggiunto_pagamento_non_completo', 'ORARIO RITIRO RAGGIUNTO — PAGAMENTO NON COMPLETO', 'Appena la condizione si verifica', 'ORARIO RITIRO RAGGIUNTO — PAGAMENTO NON COMPLETO — reparto Amministrazione.', 'booking', 'pagamenti', 'bloccante', 'Amministrazione', 0, 'minutes_after', true, 'in_attesa', 620),
  ('pag_link_pagamento_non_inviato', 'Link pagamento non inviato', '120 minuti prima', 'Link pagamento non inviato — reparto Amministrazione.', 'booking', 'pagamenti', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 630),
  ('pag_link_pagamento_inviato_non_pagato', 'Link pagamento inviato ma non pagato', '120 minuti prima', 'Link pagamento inviato ma non pagato — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 640),
  ('pag_link_pagamento_scaduto', 'Link pagamento scaduto', '120 minuti prima', 'Link pagamento scaduto — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 650),
  ('pag_pagamento_fallito', 'Pagamento fallito', '120 minuti prima', 'Pagamento fallito — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 660),
  ('pag_pagamento_rifiutato', 'Pagamento rifiutato', '120 minuti prima', 'Pagamento rifiutato — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 670),
  ('pag_pagamento_verificare', 'Pagamento da verificare', '120 minuti prima', 'Pagamento da verificare — reparto Amministrazione.', 'booking', 'pagamenti', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 680),
  ('pag_bonifico_atteso', 'Bonifico atteso', '120 minuti prima', 'Bonifico atteso — reparto Amministrazione.', 'booking', 'pagamenti', 'informativo', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 690),
  ('pag_bonifico_non_verificato', 'Bonifico non verificato', '120 minuti prima', 'Bonifico non verificato — reparto Amministrazione.', 'booking', 'pagamenti', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 700),
  ('pag_bonifico_istantaneo_controllare', 'Bonifico istantaneo da controllare', '120 minuti prima', 'Bonifico istantaneo da controllare — reparto Amministrazione.', 'booking', 'pagamenti', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 710),
  ('pag_extra_non_pagati', 'Extra non pagati', '120 minuti prima', 'Extra non pagati — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 720),
  ('pag_chilometri_extra_non_pagati', 'Chilometri extra non pagati', '120 minuti prima', 'Chilometri extra non pagati — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 730),
  ('pag_estensione_noleggio_non_pagata', 'Estensione noleggio non pagata', '120 minuti prima', 'Estensione noleggio non pagata — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 740),
  ('pag_secondo_conducente_non_pagato', 'Secondo conducente non pagato', '120 minuti prima', 'Secondo conducente non pagato — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 750),
  ('pag_supplemento_under_25_non_pagato', 'Supplemento under 25 non pagato', '120 minuti prima', 'Supplemento under 25 non pagato — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 760),
  ('pag_supplemento_patente_recente_non_pagato', 'Supplemento patente recente non pagato', '120 minuti prima', 'Supplemento patente recente non pagato — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 770),
  ('pag_consegna_ritiro_fuori_sede_non_pagati', 'Consegna/ritiro fuori sede non pagati', '120 minuti prima', 'Consegna/ritiro fuori sede non pagati — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 780),
  ('pag_accessori_non_pagati', 'Accessori non pagati', '120 minuti prima', 'Accessori non pagati — reparto Amministrazione.', 'booking', 'pagamenti', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 790),
  ('pag_danno_addebito_ancora_aperto', 'Danno/addebito ancora aperto', '120 minuti prima', 'Danno/addebito ancora aperto — reparto Amministrazione.', 'booking', 'pagamenti', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 800),
  ('cau_cauzione_richiesta_non_incassata', 'Cauzione richiesta ma non incassata', '120 minuti prima', 'Cauzione richiesta ma non incassata — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 810),
  ('cau_ritiro_tra_60_minuti_cauzione_mancante', 'Ritiro tra 60 minuti — cauzione mancante', '60 minuti prima', 'Ritiro tra 60 minuti — cauzione mancante — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 60, 'minutes_before', true, 'in_attesa', 830),
  ('cau_ritiro_tra_10_minuti_cauzione_mancante', 'Ritiro tra 10 minuti — cauzione mancante', '10 minuti prima', 'Ritiro tra 10 minuti — cauzione mancante — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 10, 'minutes_before', true, 'in_attesa', 840),
  ('cau_orario_ritiro_raggiunto_cauzione_mancante', 'ORARIO RITIRO RAGGIUNTO — CAUZIONE MANCANTE', 'Appena la condizione si verifica', 'ORARIO RITIRO RAGGIUNTO — CAUZIONE MANCANTE — reparto Amministrazione.', 'booking', 'cauzione', 'bloccante', 'Amministrazione', 0, 'minutes_after', true, 'in_attesa', 850),
  ('cau_preautorizzazione_non_effettuata', 'Preautorizzazione non effettuata', '120 minuti prima', 'Preautorizzazione non effettuata — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 860),
  ('cau_preautorizzazione_fallita', 'Preautorizzazione fallita', '120 minuti prima', 'Preautorizzazione fallita — reparto Amministrazione.', 'booking', 'cauzione', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 870),
  ('cau_preautorizzazione_rifiutata', 'Preautorizzazione rifiutata', '120 minuti prima', 'Preautorizzazione rifiutata — reparto Amministrazione.', 'booking', 'cauzione', 'urgente', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 880),
  ('cau_cauzione_inferiore_all_importo_richiesto', 'Cauzione inferiore all''importo richiesto', '120 minuti prima', 'Cauzione inferiore all''importo richiesto — reparto Amministrazione.', 'booking', 'cauzione', 'informativo', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 890),
  ('cau_garanzia_alternativa_verificare', 'Garanzia alternativa da verificare', '120 minuti prima', 'Garanzia alternativa da verificare — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 900),
  ('cau_formula_senza_cauzione_non_ancora_autorizzata', 'Formula senza cauzione non ancora autorizzata', '120 minuti prima', 'Formula senza cauzione non ancora autorizzata — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 120, 'minutes_before', true, 'in_attesa', 910),
  ('cau_cauzione_trattenere_temporaneamente', 'Cauzione da trattenere temporaneamente', '1 giorni prima', 'Cauzione da trattenere temporaneamente — reparto Amministrazione.', 'booking', 'cauzione', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 920),
  ('cau_cauzione_sbloccare', 'Cauzione da sbloccare', '1 giorni prima', 'Cauzione da sbloccare — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 930),
  ('cau_cauzione_restituire', 'Cauzione da restituire', '1 giorni prima', 'Cauzione da restituire — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 940),
  ('cau_scadenza_restituzione_cauzione_vicina', 'Scadenza restituzione cauzione vicina', '7 giorni prima', 'Scadenza restituzione cauzione vicina — reparto Amministrazione.', 'booking', 'cauzione', 'informativo', 'Amministrazione', 7, 'days', true, 'in_attesa', 950),
  ('cau_termine_restituzione_cauzione_raggiunto', 'Termine restituzione cauzione raggiunto', '0 giorni prima', 'Termine restituzione cauzione raggiunto — reparto Amministrazione.', 'booking', 'cauzione', 'urgente', 'Amministrazione', 0, 'days', true, 'in_attesa', 960),
  ('cau_termine_restituzione_cauzione_superato', 'Termine restituzione cauzione superato', '0 giorni prima', 'Termine restituzione cauzione superato — reparto Amministrazione.', 'booking', 'cauzione', 'urgente', 'Amministrazione', 0, 'days', true, 'in_attesa', 970),
  ('cau_cauzione_restituita_non_confermata', 'Cauzione restituita ma non confermata', '1 giorni prima', 'Cauzione restituita ma non confermata — reparto Amministrazione.', 'booking', 'cauzione', 'urgente', 'Amministrazione', 1, 'days', true, 'in_attesa', 980),
  ('cau_storno_cauzione_verificare', 'Storno cauzione da verificare', '1 giorni prima', 'Storno cauzione da verificare — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 990),
  ('cau_pratica_cauzione_ancora_aperta_dopo_chiusura', 'Pratica cauzione ancora aperta dopo chiusura noleggio', '1 giorni prima', 'Pratica cauzione ancora aperta dopo chiusura noleggio — reparto Amministrazione.', 'booking', 'cauzione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1000),
  ('ric_riconsegna_prevista_tra_60_minuti', 'Riconsegna prevista tra 60 minuti', '60 minuti prima', 'Riconsegna prevista tra 60 minuti — reparto Front Office.', 'booking', 'riconsegna', 'informativo', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1010),
  ('ric_riconsegna_prevista_tra_30_minuti', 'Riconsegna prevista tra 30 minuti', '30 minuti prima', 'Riconsegna prevista tra 30 minuti — reparto Front Office.', 'booking', 'riconsegna', 'informativo', 'Front Office', 30, 'minutes_before', true, 'in_attesa', 1020),
  ('ric_orario_riconsegna_raggiunto', 'Orario riconsegna raggiunto', 'Appena la condizione si verifica', 'Orario riconsegna raggiunto — reparto Front Office.', 'booking', 'riconsegna', 'urgente', 'Front Office', 0, 'minutes_after', true, 'in_attesa', 1040),
  ('ric_cliente_ritardo_30_minuti', 'Cliente in ritardo di 30 minuti', '30 minuti dopo', 'Cliente in ritardo di 30 minuti — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 30, 'minutes_after', true, 'in_attesa', 1060),
  ('ric_cliente_ritardo_60_minuti', 'Cliente in ritardo di 60 minuti', '60 minuti dopo', 'Cliente in ritardo di 60 minuti — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_after', true, 'in_attesa', 1070),
  ('ric_riconsegna_gravemente_ritardo', 'RICONSEGNA GRAVEMENTE IN RITARDO', '15 minuti dopo', 'RICONSEGNA GRAVEMENTE IN RITARDO — reparto Front Office.', 'booking', 'riconsegna', 'bloccante', 'Front Office', 15, 'minutes_after', true, 'in_attesa', 1080),
  ('ric_cliente_non_contattato_dopo_ritardo', 'Cliente non contattato dopo ritardo', '60 minuti prima', 'Cliente non contattato dopo ritardo — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1090),
  ('ric_nuovo_cliente_attende_stesso_veicolo', 'Nuovo cliente attende lo stesso veicolo', '60 minuti prima', 'Nuovo cliente attende lo stesso veicolo — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1100),
  ('ric_ritardo_compromette_noleggio_successivo', 'Ritardo che compromette noleggio successivo', '60 minuti prima', 'Ritardo che compromette noleggio successivo — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1110),
  ('ric_estensione_noleggio_non_formalizzata', 'Estensione noleggio non formalizzata', '60 minuti prima', 'Estensione noleggio non formalizzata — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1120),
  ('ric_estensione_non_pagata', 'Estensione non pagata', '60 minuti prima', 'Estensione non pagata — reparto Front Office.', 'booking', 'riconsegna', 'urgente', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1130),
  ('ric_contratto_scaduto_veicolo_ancora_fuori', 'Contratto scaduto ma veicolo ancora fuori', '60 minuti prima', 'Contratto scaduto ma veicolo ancora fuori — reparto Front Office.', 'booking', 'riconsegna', 'urgente', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1140),
  ('ric_veicolo_riconsegnato_pratica_ancora_aperta', 'Veicolo riconsegnato ma pratica ancora aperta', '60 minuti prima', 'Veicolo riconsegnato ma pratica ancora aperta — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1150),
  ('ric_check_rientro_non_effettuato', 'Check-in di rientro non effettuato', '60 minuti prima', 'Check-in di rientro non effettuato — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1160),
  ('ric_chilometri_finali_non_inseriti', 'Chilometri finali non inseriti', '60 minuti prima', 'Chilometri finali non inseriti — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1170),
  ('ric_carburante_finale_non_inserito', 'Carburante finale non inserito', '60 minuti prima', 'Carburante finale non inserito — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1180),
  ('ric_foto_rientro_mancanti', 'Foto rientro mancanti', '60 minuti prima', 'Foto rientro mancanti — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1190),
  ('ric_video_rientro_mancante', 'Video rientro mancante', '60 minuti prima', 'Video rientro mancante — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1200),
  ('ric_firma_verbale_riconsegna_mancante', 'Firma/verbale riconsegna mancante', '60 minuti prima', 'Firma/verbale riconsegna mancante — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1210),
  ('ric_chiavi_non_riconsegnate', 'Chiavi non riconsegnate', '60 minuti prima', 'Chiavi non riconsegnate — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1220),
  ('ric_accessori_non_riconsegnati', 'Accessori non riconsegnati', '60 minuti prima', 'Accessori non riconsegnati — reparto Front Office.', 'booking', 'riconsegna', 'attenzione', 'Front Office', 60, 'minutes_before', true, 'in_attesa', 1230),
  ('dan_controllo_carrozzeria_non_effettuato', 'Controllo carrozzeria non effettuato', '1 giorni prima', 'Controllo carrozzeria non effettuato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1240),
  ('dan_controllo_cerchi_non_effettuato', 'Controllo cerchi non effettuato', '1 giorni prima', 'Controllo cerchi non effettuato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1250),
  ('dan_controllo_pneumatici_non_effettuato', 'Controllo pneumatici non effettuato', '1 giorni prima', 'Controllo pneumatici non effettuato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1260),
  ('dan_controllo_vetri_non_effettuato', 'Controllo vetri non effettuato', '1 giorni prima', 'Controllo vetri non effettuato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1270),
  ('dan_controllo_interni_non_effettuato', 'Controllo interni non effettuato', '1 giorni prima', 'Controllo interni non effettuato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1280),
  ('dan_controllo_sottoscocca_non_effettuato', 'Controllo sottoscocca non effettuato', '1 giorni prima', 'Controllo sottoscocca non effettuato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1290),
  ('dan_nuovo_danno_rilevato', 'Nuovo danno rilevato', '1 giorni prima', 'Nuovo danno rilevato — reparto Officina.', 'booking', 'danni', 'informativo', 'Officina', 1, 'days', true, 'in_attesa', 1300),
  ('dan_danno_rilevato_non_fotografato', 'Danno rilevato ma non fotografato', '1 giorni prima', 'Danno rilevato ma non fotografato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1310),
  ('dan_danno_rilevato_non_valorizzato', 'Danno rilevato ma non valorizzato', '1 giorni prima', 'Danno rilevato ma non valorizzato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1320),
  ('dan_danno_rilevato_cliente_non_notificato', 'Danno rilevato ma cliente non notificato', '1 giorni prima', 'Danno rilevato ma cliente non notificato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1330),
  ('dan_danno_pratica_ancora_aperta', 'Danno con pratica ancora aperta', '1 giorni prima', 'Danno con pratica ancora aperta — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1340),
  ('dan_preventivo_danno_mancante', 'Preventivo danno mancante', '1 giorni prima', 'Preventivo danno mancante — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1350),
  ('dan_addebito_danno_non_effettuato', 'Addebito danno non effettuato', '1 giorni prima', 'Addebito danno non effettuato — reparto Officina.', 'booking', 'danni', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 1360),
  ('dan_veicolo_danno_assegnato_nuovo_noleggio', 'Veicolo con danno assegnato a nuovo noleggio', '1 giorni prima', 'Veicolo con danno assegnato a nuovo noleggio — reparto Officina.', 'booking', 'danni', 'informativo', 'Officina', 1, 'days', true, 'in_attesa', 1370),
  ('dan_danno_grave_bloccare_disponibilita_veicolo', 'Danno grave — bloccare disponibilita'' veicolo', '1 giorni prima', 'Danno grave — bloccare disponibilita'' veicolo — reparto Officina.', 'booking', 'danni', 'urgente', 'Officina', 1, 'days', true, 'in_attesa', 1380),
  ('sin_sinistro_aperto', 'Sinistro aperto', '1 giorni prima', 'Sinistro aperto — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1390),
  ('sin_sinistro_senza_fotografie', 'Sinistro senza fotografie', '1 giorni prima', 'Sinistro senza fotografie — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1400),
  ('sin_sinistro_senza_dinamica', 'Sinistro senza dinamica', '1 giorni prima', 'Sinistro senza dinamica — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1410),
  ('sin_sinistro_senza_documenti_controparte', 'Sinistro senza documenti controparte', '1 giorni prima', 'Sinistro senza documenti controparte — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1420),
  ('sin_cid_cai_mancante', 'CID/CAI mancante', '1 giorni prima', 'CID/CAI mancante — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1430),
  ('sin_denuncia_assicurativa_non_inviata', 'Denuncia assicurativa non inviata', '1 giorni prima', 'Denuncia assicurativa non inviata — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1440),
  ('sin_termine_denuncia_assicurativa_scadenza', 'Termine denuncia assicurativa in scadenza', '7 giorni prima', 'Termine denuncia assicurativa in scadenza — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 1450),
  ('sin_perizia_prenotare', 'Perizia da prenotare', '1 giorni prima', 'Perizia da prenotare — reparto Amministrazione.', 'booking', 'sinistri', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 1460),
  ('sin_perizia_programmata_arrivo', 'Perizia programmata in arrivo', '1 giorni prima', 'Perizia programmata in arrivo — reparto Amministrazione.', 'booking', 'sinistri', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 1470),
  ('sin_perizia_non_completata', 'Perizia non completata', '1 giorni prima', 'Perizia non completata — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1480),
  ('sin_preventivo_carrozzeria_mancante', 'Preventivo carrozzeria mancante', '1 giorni prima', 'Preventivo carrozzeria mancante — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 1490),
  ('sin_sinistro_senza_aggiornamenti_x_giorni', 'Sinistro senza aggiornamenti da X giorni', '3 giorni prima', 'Sinistro senza aggiornamenti da X giorni — reparto Amministrazione.', 'booking', 'sinistri', 'attenzione', 'Amministrazione', 3, 'days', true, 'in_attesa', 1500),
  ('sin_pratica_assicurativa_ferma', 'Pratica assicurativa ferma', '1 giorni prima', 'Pratica assicurativa ferma — reparto Amministrazione.', 'booking', 'sinistri', 'urgente', 'Amministrazione', 1, 'days', true, 'in_attesa', 1510),
  ('sin_rimborso_assicurativo_atteso', 'Rimborso assicurativo atteso', '1 giorni prima', 'Rimborso assicurativo atteso — reparto Amministrazione.', 'booking', 'sinistri', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 1520),
  ('sin_veicolo_fermo_sinistro_x_giorni', 'Veicolo fermo per sinistro da X giorni', '3 giorni prima', 'Veicolo fermo per sinistro da X giorni — reparto Amministrazione.', 'booking', 'sinistri', 'urgente', 'Amministrazione', 3, 'days', true, 'in_attesa', 1530),
  ('lav_lavaggio_tra_60_minuti', 'Lavaggio tra 60 minuti', '60 minuti prima', 'Lavaggio tra 60 minuti — reparto Lavaggio.', 'booking', 'lavaggi', 'informativo', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1550),
  ('lav_lavaggio_tra_30_minuti', 'Lavaggio tra 30 minuti', '30 minuti prima', 'Lavaggio tra 30 minuti — reparto Lavaggio.', 'booking', 'lavaggi', 'informativo', 'Lavaggio', 30, 'minutes_before', true, 'in_attesa', 1560),
  ('lav_lavaggio_tra_10_minuti', 'Lavaggio tra 10 minuti', '10 minuti prima', 'Lavaggio tra 10 minuti — reparto Lavaggio.', 'booking', 'lavaggi', 'informativo', 'Lavaggio', 10, 'minutes_before', true, 'in_attesa', 1570),
  ('lav_cliente_lavaggio_ritardo', 'Cliente lavaggio in ritardo', '15 minuti dopo', 'Cliente lavaggio in ritardo — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 15, 'minutes_after', true, 'in_attesa', 1580),
  ('lav_lavaggio_non_pagato', 'Lavaggio non pagato', '60 minuti prima', 'Lavaggio non pagato — reparto Lavaggio.', 'booking', 'lavaggi', 'urgente', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1590),
  ('lav_acconto_lavaggio_mancante', 'Acconto lavaggio mancante', '60 minuti prima', 'Acconto lavaggio mancante — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1600),
  ('lav_veicolo_lavaggio_non_ancora_arrivato', 'Veicolo lavaggio non ancora arrivato', '15 minuti dopo', 'Veicolo lavaggio non ancora arrivato — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 15, 'minutes_after', true, 'in_attesa', 1610),
  ('lav_operatore_lavaggio_non_assegnato', 'Operatore lavaggio non assegnato', '60 minuti prima', 'Operatore lavaggio non assegnato — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1620),
  ('lav_lavaggio_non_iniziato_entro_orario_previsto', 'Lavaggio non iniziato entro orario previsto', '5 minuti dopo', 'Lavaggio non iniziato entro orario previsto — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 5, 'minutes_after', true, 'in_attesa', 1630),
  ('lav_lavaggio_ritardo', 'Lavaggio in ritardo', '15 minuti dopo', 'Lavaggio in ritardo — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 15, 'minutes_after', true, 'in_attesa', 1640),
  ('lav_lavaggio_prossimo_all_orario_consegna', 'Lavaggio prossimo all''orario di consegna', '7 giorni prima', 'Lavaggio prossimo all''orario di consegna — reparto Lavaggio.', 'booking', 'lavaggi', 'informativo', 'Lavaggio', 7, 'days', true, 'in_attesa', 1650),
  ('lav_lavaggio_non_completato', 'Lavaggio non completato', '60 minuti prima', 'Lavaggio non completato — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1660),
  ('lav_controllo_qualita_lavaggio_mancante', 'Controllo qualita'' lavaggio mancante', '60 minuti prima', 'Controllo qualita'' lavaggio mancante — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1670),
  ('lav_foto_finali_mancanti', 'Foto finali mancanti', '60 minuti prima', 'Foto finali mancanti — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1680),
  ('lav_cliente_avvisare_veicolo_pronto', 'Cliente da avvisare che il veicolo e'' pronto', '60 minuti prima', 'Cliente da avvisare che il veicolo e'' pronto — reparto Lavaggio.', 'booking', 'lavaggi', 'informativo', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1690),
  ('lav_veicolo_pronto_cliente_non_ancora_ritirato', 'Veicolo pronto ma cliente non ancora ritirato', '60 minuti prima', 'Veicolo pronto ma cliente non ancora ritirato — reparto Lavaggio.', 'booking', 'lavaggi', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1700),
  ('prp_veicolo_rientrato_lavaggio_programmare', 'Veicolo rientrato — lavaggio da programmare', '60 minuti prima', 'Veicolo rientrato — lavaggio da programmare — reparto Lavaggio.', 'fleet', 'preparazione', 'informativo', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1710),
  ('prp_veicolo_sporco_prenotazione_imminente', 'Veicolo sporco con prenotazione imminente', '60 minuti prima', 'Veicolo sporco con prenotazione imminente — reparto Lavaggio.', 'fleet', 'preparazione', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1720),
  ('prp_veicolo_igienizzare', 'Veicolo da igienizzare', '60 minuti prima', 'Veicolo da igienizzare — reparto Lavaggio.', 'fleet', 'preparazione', 'informativo', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1730),
  ('prp_interni_controllare', 'Interni da controllare', '60 minuti prima', 'Interni da controllare — reparto Lavaggio.', 'fleet', 'preparazione', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1740),
  ('prp_carburante_ripristinare', 'Carburante da ripristinare', '60 minuti prima', 'Carburante da ripristinare — reparto Lavaggio.', 'fleet', 'preparazione', 'informativo', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1750),
  ('prp_adblue_ripristinare', 'AdBlue da ripristinare', '60 minuti prima', 'AdBlue da ripristinare — reparto Lavaggio.', 'fleet', 'preparazione', 'informativo', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1760),
  ('prp_liquido_lavavetri_basso', 'Liquido lavavetri basso', '60 minuti prima', 'Liquido lavavetri basso — reparto Lavaggio.', 'fleet', 'preparazione', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1770),
  ('prp_veicolo_mettere_carica', 'Veicolo da mettere in carica', '60 minuti prima', 'Veicolo da mettere in carica — reparto Lavaggio.', 'fleet', 'preparazione', 'informativo', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1780),
  ('prp_batteria_veicolo_bassa', 'Batteria veicolo bassa', '60 minuti prima', 'Batteria veicolo bassa — reparto Lavaggio.', 'fleet', 'preparazione', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1790),
  ('prp_preparazione_veicolo_non_completata', 'Preparazione veicolo non completata', '60 minuti prima', 'Preparazione veicolo non completata — reparto Lavaggio.', 'fleet', 'preparazione', 'attenzione', 'Lavaggio', 60, 'minutes_before', true, 'in_attesa', 1800),
  ('prp_veicolo_non_pronto_prossima_uscita', 'Veicolo non pronto per prossima uscita', '7 giorni prima', 'Veicolo non pronto per prossima uscita — reparto Lavaggio.', 'fleet', 'preparazione', 'attenzione', 'Lavaggio', 7, 'days', true, 'in_attesa', 1810),
  ('man_tagliando_scadenza_data', 'Tagliando in scadenza per data', '7 giorni prima', 'Tagliando in scadenza per data — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1820),
  ('man_tagliando_scadenza_chilometraggio', 'Tagliando in scadenza per chilometraggio', '7 giorni prima', 'Tagliando in scadenza per chilometraggio — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1830),
  ('man_tagliando_scaduto', 'Tagliando scaduto', '7 giorni prima', 'Tagliando scaduto — reparto Officina.', 'fleet', 'manutenzione', 'urgente', 'Officina', 7, 'days', true, 'in_attesa', 1840),
  ('man_cambio_olio_scadenza', 'Cambio olio in scadenza', '7 giorni prima', 'Cambio olio in scadenza — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1850),
  ('man_cambio_olio_scaduto', 'Cambio olio scaduto', '7 giorni prima', 'Cambio olio scaduto — reparto Officina.', 'fleet', 'manutenzione', 'urgente', 'Officina', 7, 'days', true, 'in_attesa', 1860),
  ('man_livello_olio_controllare', 'Livello olio da controllare', '7 giorni prima', 'Livello olio da controllare — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1870),
  ('man_controllo_freni_scadenza', 'Controllo freni in scadenza', '7 giorni prima', 'Controllo freni in scadenza — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1880),
  ('man_dischi_freno_controllare', 'Dischi freno da controllare', '7 giorni prima', 'Dischi freno da controllare — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1910),
  ('man_batteria_controllare', 'Batteria da controllare', '7 giorni prima', 'Batteria da controllare — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1920),
  ('man_batteria_sostituire', 'Batteria da sostituire', '7 giorni prima', 'Batteria da sostituire — reparto Officina.', 'fleet', 'manutenzione', 'informativo', 'Officina', 7, 'days', true, 'in_attesa', 1930),
  ('man_liquido_refrigerante_controllare', 'Liquido refrigerante da controllare', '7 giorni prima', 'Liquido refrigerante da controllare — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1940),
  ('man_liquido_freni_controllare', 'Liquido freni da controllare', '7 giorni prima', 'Liquido freni da controllare — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1950),
  ('man_cinghia_accessori_controllare', 'Cinghia/accessori da controllare', '7 giorni prima', 'Cinghia/accessori da controllare — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1960),
  ('man_manutenzione_cambio_scadenza', 'Manutenzione cambio in scadenza', '7 giorni prima', 'Manutenzione cambio in scadenza — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 1970),
  ('man_manutenzione_programmata_imminente', 'Manutenzione programmata imminente', '7 giorni prima', 'Manutenzione programmata imminente — reparto Officina.', 'fleet', 'manutenzione', 'informativo', 'Officina', 7, 'days', true, 'in_attesa', 1980),
  ('man_richiamo_ufficiale_casa_costruttrice_eseguire', 'Richiamo ufficiale casa costruttrice da eseguire', '7 giorni prima', 'Richiamo ufficiale casa costruttrice da eseguire — reparto Officina.', 'fleet', 'manutenzione', 'informativo', 'Officina', 7, 'days', true, 'in_attesa', 1990),
  ('man_spia_anomalia_veicolo_aperta', 'Spia/anomalia veicolo aperta', '7 giorni prima', 'Spia/anomalia veicolo aperta — reparto Officina.', 'fleet', 'manutenzione', 'urgente', 'Officina', 7, 'days', true, 'in_attesa', 2000),
  ('man_guasto_segnalato_non_risolto', 'Guasto segnalato non risolto', '7 giorni prima', 'Guasto segnalato non risolto — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2010),
  ('man_appuntamento_officina_imminente', 'Appuntamento officina imminente', '7 giorni prima', 'Appuntamento officina imminente — reparto Officina.', 'fleet', 'manutenzione', 'informativo', 'Officina', 7, 'days', true, 'in_attesa', 2020),
  ('man_veicolo_non_rientrato_prima_dell_appuntamento', 'Veicolo non rientrato prima dell''appuntamento officina', '7 giorni prima', 'Veicolo non rientrato prima dell''appuntamento officina — reparto Officina.', 'fleet', 'manutenzione', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2030),
  ('pne_gomma_anteriore_sinistra_controllare', 'Gomma anteriore sinistra da controllare', '7 giorni prima', 'Gomma anteriore sinistra da controllare — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2040),
  ('pne_gomma_anteriore_destra_controllare', 'Gomma anteriore destra da controllare', '7 giorni prima', 'Gomma anteriore destra da controllare — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2050),
  ('pne_gomma_posteriore_sinistra_controllare', 'Gomma posteriore sinistra da controllare', '7 giorni prima', 'Gomma posteriore sinistra da controllare — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2060),
  ('pne_gomma_posteriore_destra_controllare', 'Gomma posteriore destra da controllare', '7 giorni prima', 'Gomma posteriore destra da controllare — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2070),
  ('pne_battistrada_vicino_limite_impostato', 'Battistrada vicino al limite impostato', '7 giorni prima', 'Battistrada vicino al limite impostato — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2080),
  ('pne_battistrada_sotto_limite_impostato', 'Battistrada sotto il limite impostato', '7 giorni prima', 'Battistrada sotto il limite impostato — reparto Officina.', 'fleet', 'pneumatici', 'urgente', 'Officina', 7, 'days', true, 'in_attesa', 2090),
  ('pne_pressione_pneumatico_anomala', 'Pressione pneumatico anomala', '7 giorni prima', 'Pressione pneumatico anomala — reparto Officina.', 'fleet', 'pneumatici', 'urgente', 'Officina', 7, 'days', true, 'in_attesa', 2100),
  ('pne_pneumatico_danneggiato', 'Pneumatico danneggiato', '7 giorni prima', 'Pneumatico danneggiato — reparto Officina.', 'fleet', 'pneumatici', 'urgente', 'Officina', 7, 'days', true, 'in_attesa', 2110),
  ('pne_pneumatico_sostituire', 'Pneumatico da sostituire', '7 giorni prima', 'Pneumatico da sostituire — reparto Officina.', 'fleet', 'pneumatici', 'informativo', 'Officina', 7, 'days', true, 'in_attesa', 2120),
  ('pne_cambio_gomme_programmato', 'Cambio gomme programmato', '7 giorni prima', 'Cambio gomme programmato — reparto Officina.', 'fleet', 'pneumatici', 'informativo', 'Officina', 7, 'days', true, 'in_attesa', 2130),
  ('pne_cambio_gomme_non_effettuato', 'Cambio gomme non effettuato', '7 giorni prima', 'Cambio gomme non effettuato — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2140),
  ('pne_convergenza_controllare', 'Convergenza da controllare', '7 giorni prima', 'Convergenza da controllare — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2150),
  ('pne_equilibratura_controllare', 'Equilibratura da controllare', '7 giorni prima', 'Equilibratura da controllare — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2160),
  ('pne_usura_anomala_pneumatici', 'Usura anomala pneumatici', '7 giorni prima', 'Usura anomala pneumatici — reparto Officina.', 'fleet', 'pneumatici', 'urgente', 'Officina', 7, 'days', true, 'in_attesa', 2170),
  ('pne_veicolo_pneumatici_non_idonei_prossima_uscita', 'Veicolo con pneumatici non idonei alla prossima uscita', '7 giorni prima', 'Veicolo con pneumatici non idonei alla prossima uscita — reparto Officina.', 'fleet', 'pneumatici', 'attenzione', 'Officina', 7, 'days', true, 'in_attesa', 2180),
  ('sca_assicurazione_scaduta', 'Assicurazione scaduta', '7 giorni prima', 'Assicurazione scaduta — reparto Amministrazione.', 'fleet', 'scadenze', 'urgente', 'Amministrazione', 7, 'days', true, 'in_attesa', 2200),
  ('sca_bollo_scaduto', 'Bollo scaduto', '7 giorni prima', 'Bollo scaduto — reparto Amministrazione.', 'fleet', 'scadenze', 'urgente', 'Amministrazione', 7, 'days', true, 'in_attesa', 2220),
  ('sca_revisione_veicolo_scaduta', 'Revisione veicolo scaduta', '7 giorni prima', 'Revisione veicolo scaduta — reparto Amministrazione.', 'fleet', 'scadenze', 'urgente', 'Amministrazione', 7, 'days', true, 'in_attesa', 2240),
  ('sca_leasing_rata_scadenza', 'Leasing/rata in scadenza', '7 giorni prima', 'Leasing/rata in scadenza — reparto Amministrazione.', 'fleet', 'scadenze', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2250),
  ('sca_rata_finanziamento_scadenza', 'Rata finanziamento in scadenza', '7 giorni prima', 'Rata finanziamento in scadenza — reparto Amministrazione.', 'fleet', 'scadenze', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2260),
  ('sca_noleggio_lungo_termine_scadenza', 'Noleggio lungo termine in scadenza', '7 giorni prima', 'Noleggio lungo termine in scadenza — reparto Amministrazione.', 'fleet', 'scadenze', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2270),
  ('sca_contratto_veicolo_scadenza', 'Contratto veicolo in scadenza', '7 giorni prima', 'Contratto veicolo in scadenza — reparto Amministrazione.', 'fleet', 'scadenze', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2280),
  ('sca_garanzia_costruttore_scadenza', 'Garanzia costruttore in scadenza', '7 giorni prima', 'Garanzia costruttore in scadenza — reparto Amministrazione.', 'fleet', 'scadenze', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2290),
  ('sca_garanzia_aggiuntiva_scadenza', 'Garanzia aggiuntiva in scadenza', '7 giorni prima', 'Garanzia aggiuntiva in scadenza — reparto Amministrazione.', 'fleet', 'scadenze', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2300),
  ('sca_soccorso_stradale_scadenza', 'Soccorso stradale in scadenza', '7 giorni prima', 'Soccorso stradale in scadenza — reparto Amministrazione.', 'fleet', 'scadenze', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2310),
  ('mul_multa_ricevuta_associare_cliente', 'Multa ricevuta da associare al cliente', '1 giorni prima', 'Multa ricevuta da associare al cliente — reparto Amministrazione.', 'booking', 'multe', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2320),
  ('mul_multa_associata_non_notificata', 'Multa associata ma non notificata', '1 giorni prima', 'Multa associata ma non notificata — reparto Amministrazione.', 'booking', 'multe', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2330),
  ('mul_termine_comunicazione_conducente_scadenza', 'Termine comunicazione conducente in scadenza', '7 giorni prima', 'Termine comunicazione conducente in scadenza — reparto Amministrazione.', 'booking', 'multe', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2340),
  ('mul_multa_riaddebitare', 'Multa da riaddebitare', '1 giorni prima', 'Multa da riaddebitare — reparto Amministrazione.', 'booking', 'multe', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2350),
  ('mul_multa_non_pagata', 'Multa non pagata', '1 giorni prima', 'Multa non pagata — reparto Amministrazione.', 'booking', 'multe', 'urgente', 'Amministrazione', 1, 'days', true, 'in_attesa', 2360),
  ('mul_pedaggio_associare', 'Pedaggio da associare', '1 giorni prima', 'Pedaggio da associare — reparto Amministrazione.', 'booking', 'multe', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2370),
  ('mul_pedaggio_addebitare', 'Pedaggio da addebitare', '1 giorni prima', 'Pedaggio da addebitare — reparto Amministrazione.', 'booking', 'multe', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2380),
  ('mul_parcheggio_addebitare', 'Parcheggio da addebitare', '1 giorni prima', 'Parcheggio da addebitare — reparto Amministrazione.', 'booking', 'multe', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2390),
  ('mul_ztl_verificare', 'ZTL da verificare', '1 giorni prima', 'ZTL da verificare — reparto Amministrazione.', 'booking', 'multe', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2400),
  ('mul_spesa_post_noleggio_recuperare', 'Spesa post-noleggio da recuperare', '1 giorni prima', 'Spesa post-noleggio da recuperare — reparto Amministrazione.', 'booking', 'multe', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2410),
  ('mul_pratica_post_noleggio_ancora_aperta', 'Pratica post-noleggio ancora aperta', '1 giorni prima', 'Pratica post-noleggio ancora aperta — reparto Amministrazione.', 'booking', 'multe', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2420),
  ('km_chilometri_inclusi_quasi_esauriti', 'Chilometri inclusi quasi esauriti', '100 km', 'Chilometri inclusi quasi esauriti — reparto Amministrazione.', 'booking', 'chilometraggio', 'attenzione', 'Amministrazione', 100, 'km', true, 'in_attesa', 2430),
  ('km_chilometri_inclusi_superati', 'Chilometri inclusi superati', '1 giorni prima', 'Chilometri inclusi superati — reparto Amministrazione.', 'booking', 'chilometraggio', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2440),
  ('km_sforamento_chilometrico', 'Sforamento chilometrico', '1 giorni prima', 'Sforamento chilometrico — reparto Amministrazione.', 'booking', 'chilometraggio', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2450),
  ('km_addebito_chilometri_extra_calcolare', 'Addebito chilometri extra da calcolare', '1 giorni prima', 'Addebito chilometri extra da calcolare — reparto Amministrazione.', 'booking', 'chilometraggio', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2460),
  ('km_addebito_chilometri_extra_non_effettuato', 'Addebito chilometri extra non effettuato', '1 giorni prima', 'Addebito chilometri extra non effettuato — reparto Amministrazione.', 'booking', 'chilometraggio', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2470),
  ('km_chilometraggio_veicolo_non_aggiornato', 'Chilometraggio veicolo non aggiornato', '1 giorni prima', 'Chilometraggio veicolo non aggiornato — reparto Amministrazione.', 'booking', 'chilometraggio', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2480),
  ('km_chilometraggio_anomalo_rispetto_all_ultimo', 'Chilometraggio anomalo rispetto all''ultimo dato', '1 giorni prima', 'Chilometraggio anomalo rispetto all''ultimo dato — reparto Amministrazione.', 'booking', 'chilometraggio', 'urgente', 'Amministrazione', 1, 'days', true, 'in_attesa', 2490),
  ('pre_nuova_prenotazione_non_verificata', 'Nuova prenotazione non verificata', '120 minuti prima', 'Nuova prenotazione non verificata — reparto Front Office.', 'booking', 'prenotazioni', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2500),
  ('pre_prenotazione_senza_veicolo_assegnato', 'Prenotazione senza veicolo assegnato', '120 minuti prima', 'Prenotazione senza veicolo assegnato — reparto Front Office.', 'booking', 'prenotazioni', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2510),
  ('pre_prenotazione_senza_operatore_assegnato', 'Prenotazione senza operatore assegnato', '120 minuti prima', 'Prenotazione senza operatore assegnato — reparto Front Office.', 'booking', 'prenotazioni', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2520),
  ('pre_sovrapposizione_prenotazioni', 'Sovrapposizione prenotazioni', '120 minuti prima', 'Sovrapposizione prenotazioni — reparto Front Office.', 'booking', 'prenotazioni', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2530),
  ('pre_doppia_prenotazione_stesso_veicolo', 'Doppia prenotazione stesso veicolo', '120 minuti prima', 'Doppia prenotazione stesso veicolo — reparto Front Office.', 'booking', 'prenotazioni', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2540),
  ('pre_tempo_insufficiente_tra_due_noleggi', 'Tempo insufficiente tra due noleggi', '120 minuti prima', 'Tempo insufficiente tra due noleggi — reparto Front Office.', 'booking', 'prenotazioni', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2550),
  ('pre_tempo_insufficiente_lavaggio_tra_due_noleggi', 'Tempo insufficiente per lavaggio tra due noleggi', '120 minuti prima', 'Tempo insufficiente per lavaggio tra due noleggi — reparto Front Office.', 'booking', 'prenotazioni', 'urgente', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2560),
  ('pre_prenotazione_modificata_ricontrollare', 'Prenotazione modificata da ricontrollare', '120 minuti prima', 'Prenotazione modificata da ricontrollare — reparto Front Office.', 'booking', 'prenotazioni', 'informativo', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2570),
  ('pre_prenotazione_cancellata_attivita_ancora', 'Prenotazione cancellata con attivita'' ancora aperte', '120 minuti prima', 'Prenotazione cancellata con attivita'' ancora aperte — reparto Front Office.', 'booking', 'prenotazioni', 'informativo', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2580),
  ('pre_prenotazione_senza_pagamento', 'Prenotazione senza pagamento', '120 minuti prima', 'Prenotazione senza pagamento — reparto Front Office.', 'booking', 'prenotazioni', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2590),
  ('pre_prenotazione_senza_contratto', 'Prenotazione senza contratto', '120 minuti prima', 'Prenotazione senza contratto — reparto Front Office.', 'booking', 'prenotazioni', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2600),
  ('pre_prenotazione_senza_cauzione', 'Prenotazione senza cauzione', '120 minuti prima', 'Prenotazione senza cauzione — reparto Front Office.', 'booking', 'prenotazioni', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2610),
  ('pre_prenotazione_senza_documenti', 'Prenotazione senza documenti', '120 minuti prima', 'Prenotazione senza documenti — reparto Front Office.', 'booking', 'prenotazioni', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2620),
  ('pre_prenotazione_imminente_pratica_incompleta', 'Prenotazione imminente con pratica incompleta', '120 minuti prima', 'Prenotazione imminente con pratica incompleta — reparto Front Office.', 'booking', 'prenotazioni', 'attenzione', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2630),
  ('pre_veicolo_segnato_indisponibile_presente_prenotazione', 'Veicolo segnato indisponibile ma presente in prenotazione', '120 minuti prima', 'Veicolo segnato indisponibile ma presente in prenotazione — reparto Front Office.', 'booking', 'prenotazioni', 'informativo', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2640),
  ('pre_veicolo_officina_presente_prenotazione', 'Veicolo in officina ma presente in prenotazione', '120 minuti prima', 'Veicolo in officina ma presente in prenotazione — reparto Front Office.', 'booking', 'prenotazioni', 'informativo', 'Front Office', 120, 'minutes_before', true, 'in_attesa', 2650),
  ('fat_fattura_generare', 'Fattura da generare', '1 giorni prima', 'Fattura da generare — reparto Amministrazione.', 'booking', 'fatturazione', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2660),
  ('fat_fattura_non_generata_dopo_pagamento', 'Fattura non generata dopo pagamento', '1 giorni prima', 'Fattura non generata dopo pagamento — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2670),
  ('fat_fattura_dati_mancanti', 'Fattura con dati mancanti', '1 giorni prima', 'Fattura con dati mancanti — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2680),
  ('fat_codice_fiscale_mancante_fattura', 'Codice fiscale mancante in fattura', '1 giorni prima', 'Codice fiscale mancante in fattura — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2690),
  ('fat_partita_iva_mancante', 'Partita IVA mancante', '1 giorni prima', 'Partita IVA mancante — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2700),
  ('fat_codice_sdi_pec_mancante_quando_necessario', 'Codice SDI/PEC mancante quando necessario', '1 giorni prima', 'Codice SDI/PEC mancante quando necessario — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2710),
  ('fat_fattura_correggere', 'Fattura da correggere', '1 giorni prima', 'Fattura da correggere — reparto Amministrazione.', 'booking', 'fatturazione', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2720),
  ('fat_nota_credito_generare', 'Nota di credito da generare', '1 giorni prima', 'Nota di credito da generare — reparto Amministrazione.', 'booking', 'fatturazione', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2730),
  ('fat_rimborso_cliente_effettuare', 'Rimborso cliente da effettuare', '1 giorni prima', 'Rimborso cliente da effettuare — reparto Amministrazione.', 'booking', 'fatturazione', 'informativo', 'Amministrazione', 1, 'days', true, 'in_attesa', 2740),
  ('fat_rimborso_cliente_scadenza', 'Rimborso cliente in scadenza', '7 giorni prima', 'Rimborso cliente in scadenza — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 7, 'days', true, 'in_attesa', 2750),
  ('fat_rimborso_non_completato', 'Rimborso non completato', '1 giorni prima', 'Rimborso non completato — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2760),
  ('fat_pagamento_registrato_senza_fattura', 'Pagamento registrato senza fattura', '1 giorni prima', 'Pagamento registrato senza fattura — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2770),
  ('fat_fattura_emessa_senza_pagamento_associato', 'Fattura emessa senza pagamento associato', '1 giorni prima', 'Fattura emessa senza pagamento associato — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2780),
  ('fat_incasso_non_riconciliato', 'Incasso non riconciliato', '1 giorni prima', 'Incasso non riconciliato — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2790),
  ('fat_movimento_amministrativo_senza_pratica_associata', 'Movimento amministrativo senza pratica associata', '1 giorni prima', 'Movimento amministrativo senza pratica associata — reparto Amministrazione.', 'booking', 'fatturazione', 'attenzione', 'Amministrazione', 1, 'days', true, 'in_attesa', 2800),
  ('led_nuova_lead_non_presa_carico', 'Nuova lead non presa in carico', '60 minuti dopo', 'Nuova lead non presa in carico — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2810),
  ('led_lead_senza_risposta_x_minuti', 'Lead senza risposta da X minuti', '30 minuti dopo', 'Lead senza risposta da X minuti — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 30, 'minutes_after', true, 'in_attesa', 2820),
  ('led_preventivo_richiesto_non_inviato', 'Preventivo richiesto ma non inviato', '60 minuti dopo', 'Preventivo richiesto ma non inviato — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2830),
  ('led_preventivo_inviato_senza_risposta', 'Preventivo inviato senza risposta', '60 minuti dopo', 'Preventivo inviato senza risposta — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2840),
  ('led_preventivo_scadenza', 'Preventivo in scadenza', '7 giorni prima', 'Preventivo in scadenza — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 7, 'days', true, 'in_attesa', 2850),
  ('led_prezzo_bloccato_prossimo_scadenza', 'Prezzo bloccato prossimo alla scadenza', '7 giorni prima', 'Prezzo bloccato prossimo alla scadenza — reparto Commerciale.', 'booking', 'lead', 'informativo', 'Commerciale', 7, 'days', true, 'in_attesa', 2860),
  ('led_prezzo_bloccato_scaduto', 'Prezzo bloccato scaduto', '60 minuti dopo', 'Prezzo bloccato scaduto — reparto Commerciale.', 'booking', 'lead', 'urgente', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2870),
  ('led_cliente_ricontattare', 'Cliente da ricontattare', '60 minuti dopo', 'Cliente da ricontattare — reparto Commerciale.', 'booking', 'lead', 'informativo', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2880),
  ('led_cliente_interessato_senza_follow_up', 'Cliente interessato senza follow-up', '60 minuti dopo', 'Cliente interessato senza follow-up — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2890),
  ('led_documenti_richiesti_non_ricevuti', 'Documenti richiesti ma non ricevuti', '60 minuti dopo', 'Documenti richiesti ma non ricevuti — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2900),
  ('led_pagamento_richiesto_non_ricevuto', 'Pagamento richiesto ma non ricevuto', '60 minuti dopo', 'Pagamento richiesto ma non ricevuto — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2910),
  ('led_lead_calda_senza_attivita_programmata', 'Lead calda senza attivita'' programmata', '60 minuti dopo', 'Lead calda senza attivita'' programmata — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2920),
  ('led_prenotazione_iniziata_non_completata', 'Prenotazione iniziata ma non completata', '60 minuti dopo', 'Prenotazione iniziata ma non completata — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2930),
  ('led_cliente_ha_aperto_link_non_completato_prenotazione', 'Cliente ha aperto link ma non completato prenotazione', '60 minuti dopo', 'Cliente ha aperto link ma non completato prenotazione — reparto Commerciale.', 'booking', 'lead', 'attenzione', 'Commerciale', 60, 'minutes_after', true, 'in_attesa', 2940),
  ('off_veicolo_portare_officina', 'Veicolo da portare in officina', '1 giorni prima', 'Veicolo da portare in officina — reparto Officina.', 'fleet', 'officina', 'informativo', 'Officina', 1, 'days', true, 'in_attesa', 2950),
  ('off_veicolo_ritirare_dall_officina', 'Veicolo da ritirare dall''officina', '1 giorni prima', 'Veicolo da ritirare dall''officina — reparto Officina.', 'fleet', 'officina', 'informativo', 'Officina', 1, 'days', true, 'in_attesa', 2960),
  ('off_appuntamento_officina_tra_24_ore', 'Appuntamento officina tra 24 ore', '1440 minuti prima', 'Appuntamento officina tra 24 ore — reparto Officina.', 'fleet', 'officina', 'informativo', 'Officina', 1440, 'minutes_before', true, 'in_attesa', 2970),
  ('off_appuntamento_officina_tra_60_minuti', 'Appuntamento officina tra 60 minuti', '60 minuti prima', 'Appuntamento officina tra 60 minuti — reparto Officina.', 'fleet', 'officina', 'informativo', 'Officina', 60, 'minutes_before', true, 'in_attesa', 2980),
  ('off_preventivo_officina_atteso', 'Preventivo officina atteso', '1 giorni prima', 'Preventivo officina atteso — reparto Officina.', 'fleet', 'officina', 'informativo', 'Officina', 1, 'days', true, 'in_attesa', 2990),
  ('off_ricambio_ordinato', 'Ricambio ordinato', '1 giorni prima', 'Ricambio ordinato — reparto Officina.', 'fleet', 'officina', 'informativo', 'Officina', 1, 'days', true, 'in_attesa', 3000),
  ('off_ricambio_non_arrivato_entro_data_prevista', 'Ricambio non arrivato entro data prevista', '1 giorni prima', 'Ricambio non arrivato entro data prevista — reparto Officina.', 'fleet', 'officina', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 3010),
  ('off_riparazione_oltre_data_prevista', 'Riparazione oltre data prevista', '1 giorni prima', 'Riparazione oltre data prevista — reparto Officina.', 'fleet', 'officina', 'attenzione', 'Officina', 1, 'days', true, 'in_attesa', 3020),
  ('off_veicolo_fermo', 'Veicolo fermo', '1 giorni prima', 'Veicolo fermo — reparto Officina.', 'fleet', 'officina', 'urgente', 'Officina', 1, 'days', true, 'in_attesa', 3030)
ON CONFLICT (id) DO NOTHING;

-- Verifica
SELECT group_key, count(*) FILTER (WHERE stato_rilevamento = 'attivo') AS attivi,
       count(*) AS totale
FROM public.system_alarms GROUP BY group_key ORDER BY group_key;