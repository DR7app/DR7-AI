# -*- coding: utf-8 -*-
import json
d = json.load(open('catalogo.json', encoding='utf-8'))
groups, entries = d['groups'], d['entries']

# I 13 allarmi che ESISTONO GIA' e funzionano: le voci del catalogo che sono
# lo stesso allarme prendono il loro id, cosi' non nasce un doppione che
# suonerebbe due volte per lo stesso motivo.
ALIAS = {
 'lav_lavaggio_arrivo': 'car_wash',
 'ric_riconsegna_prevista_tra_10_minuti': 'return_before',
 'ric_cliente_ritardo_10_minuti': 'return_after',
 'cau_cauzione_incassare': 'deposit',
 'pag_ritiro_imminente_pagamento_ancora_aperto': 'unpaid_pickup',
 'man_tagliando_scadenza_per_chilometraggio': 'fleet_service',
 'man_pastiglie_anteriori_controllare': 'fleet_brakes_front',
 'man_pastiglie_posteriori_controllare': 'fleet_brakes_rear',
 'sca_assicurazione_scadenza': 'fleet_insurance',
 'sca_bollo_scadenza': 'fleet_tax',
 'sca_revisione_veicolo_scadenza': 'fleet_inspection',
}
# Doppioni interni alla lista (revisione compare sia in Manutenzione sia in
# Scadenze veicolo): si tiene quella di Scadenze veicolo.
DROP = {'man_revisione_scadenza', 'man_revisione_scaduta'}

FLEET_GROUPS = {'preparazione', 'manutenzione', 'pneumatici', 'scadenze', 'officina'}

rows = []
for e in entries:
    if e['id'] in DROP:
        continue
    e = dict(e)
    e['legacy'] = e['id'] in ALIAS
    e['id'] = ALIAS.get(e['id'], e['id'])
    e['category'] = 'fleet' if e['group'] in FLEET_GROUPS else 'booking'
    rows.append(e)

for i, r in enumerate(rows):
    r['sort_order'] = (i + 1) * 10

def q(s):
    return "'" + s.replace("'", "''") + "'"

# ── src/data/alarmCatalog.ts ────────────────────────────────────────────────
ts = []
ts.append("""/**
 * Catalogo allarmi DR7 — sorgente unica.
 *
 * 2026-08-21 (richiesta direzione): l'inventario completo degli allarmi del
 * gestionale, 19 gruppi. Questo file NON e' la configurazione: e' l'elenco di
 * cosa esiste. I valori che l'operatore cambia (acceso/spento, anticipo,
 * priorita', reparto, canali, ripetizione) vivono in `public.system_alarms` e
 * vincono sempre su quello che c'e' scritto qui.
 *
 * `detector` e' la chiave della funzione che RILEVA l'allarme (vedi
 * src/utils/alarmDetectors.ts). Senza detector la riga resta visibile e
 * configurabile ma non puo' suonare: lo stato lo dice a schermo, cosi' nessuno
 * crede di avere una copertura che non ha.
 *
 * Generato da scripts/alarm-catalog — non modificare a mano le voci: aggiungi
 * al catalogo e rigenera, altrimenti gestionale e migration divergono.
 */

export type AlarmPriority = 'informativo' | 'attenzione' | 'urgente' | 'bloccante'
export type AlarmThresholdUnit = 'minutes_before' | 'minutes_after' | 'km' | 'days'

export interface AlarmGroup {
  key: string
  num: number
  title: string
}

export interface AlarmDefinition {
  id: string
  group: string
  label: string
  priority: AlarmPriority
  thresholdValue: number
  thresholdUnit: AlarmThresholdUnit
  reparto: string
  category: 'booking' | 'fleet'
  /** true = allarme storico gia' funzionante prima del catalogo. */
  legacy: boolean
}

export const ALARM_GROUPS: AlarmGroup[] = [""")
for g in groups:
    ts.append(f"  {{ key: '{g['key']}', num: {g['num']}, title: {q(g['title'])} }},")
ts.append("]\n")
ts.append("export const ALARM_CATALOG: AlarmDefinition[] = [")
for r in rows:
    ts.append(
        f"  {{ id: '{r['id']}', group: '{r['group']}', label: {q(r['label'])}, "
        f"priority: '{r['priority']}', thresholdValue: {r['threshold_value']}, "
        f"thresholdUnit: '{r['threshold_unit']}', reparto: {q(r['reparto'])}, "
        f"category: '{r['category']}', legacy: {'true' if r['legacy'] else 'false'} }},"
    )
ts.append("]\n")
ts.append("""export const ALARM_GROUP_TITLE: Record<string, string> = Object.fromEntries(
  ALARM_GROUPS.map(g => [g.key, `${g.num}. ${g.title}`]),
)

export const PRIORITY_LABEL: Record<AlarmPriority, string> = {
  informativo: 'Informativo',
  attenzione: 'Attenzione',
  urgente: 'Urgente',
  bloccante: 'Bloccante',
}

/** Ordine di gravita' — l'allarme piu' grave e' quello che suona per primo. */
export const PRIORITY_RANK: Record<AlarmPriority, number> = {
  informativo: 0, attenzione: 1, urgente: 2, bloccante: 3,
}
""")
open('alarmCatalog.ts', 'w', encoding='utf-8').write('\n'.join(ts))

# ── migration ───────────────────────────────────────────────────────────────
sql = []
sql.append("""-- ============================================================
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
VALUES""")

UNIT_IT = {
 'minutes_before': 'minuti prima',
 'minutes_after': 'minuti dopo',
 'days': 'giorni prima',
 'km': 'km',
}
vals = []
for r in rows:
    if r['legacy']:
        continue
    if r['threshold_unit'] == 'minutes_after' and r['threshold_value'] == 0:
        sched = 'Appena la condizione si verifica'
    else:
        sched = f"{r['threshold_value']} {UNIT_IT[r['threshold_unit']]}"
    reason = f"{r['label']} — reparto {r['reparto']}."
    vals.append(
        f"  ({q(r['id'])}, {q(r['label'])}, {q(sched)}, {q(reason)}, "
        f"'{r['category']}', '{r['group']}', '{r['priority']}', {q(r['reparto'])}, "
        f"{r['threshold_value']}, '{r['threshold_unit']}', true, 'in_attesa', {r['sort_order']})"
    )
sql.append(',\n'.join(vals))
sql.append("""ON CONFLICT (id) DO NOTHING;

-- Verifica
SELECT group_key, count(*) FILTER (WHERE stato_rilevamento = 'attivo') AS attivi,
       count(*) AS totale
FROM public.system_alarms GROUP BY group_key ORDER BY group_key;""")

open('20260821_alarm_engine.sql', 'w', encoding='utf-8').write('\n'.join(sql))
print('catalogo:', len(rows), 'voci —', sum(1 for r in rows if r['legacy']), 'gia esistenti,', len(vals), 'nuove')
