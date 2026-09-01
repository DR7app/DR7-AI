-- ═══════════════════════════════════════════════════════════════════════════
-- DR7 A.I SYSTEM CONTROL — fondazione dati (31/08/2026)
--
-- Centro operativo tecnico del gestionale: rilevazione errori, salute delle
-- integrazioni, coda delle operazioni fallite con ritentativi sicuri,
-- interruttori di emergenza, manutenzione, storico configurazioni, audit e
-- rapporti tecnici per lo sviluppatore.
--
-- Regole rispettate:
--  · Nessuna credenziale finisce qui dentro: il codice sanifica prima di
--    scrivere (netlify/functions/utils/systemControl.ts).
--  · Nessuna operazione distruttiva e' esposta da queste tabelle.
--  · Le tabelle sono NUOVE: nessuna colonna esistente viene toccata, quindi
--    eseguire questo file non puo' rompere niente di gia' in produzione.
--  · Prefisso `sc_` = System Control.
--
-- Da eseguire a mano nel SQL editor di Supabase. Finche' non gira, il
-- gestionale continua a funzionare: ogni scrittura del System Control e'
-- avvolta in try/catch e la tab mostra "migrazione non ancora eseguita".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Chi puo' leggere/operare nel System Control ─────────────────────────────
-- Volutamente SENZA email in duro (a differenza di dr7_is_direzione): questa
-- copia del gestionale e' destinata anche alla vendita, e un acquirente non
-- deve ereditare gli indirizzi DR7. Vale il ruolo scritto in `admins`.
CREATE OR REPLACE FUNCTION public.sc_puo_operare()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins a
     WHERE a.user_id = auth.uid()
       AND a.archived_at IS NULL
       AND ( a.role = 'superadmin'
             OR a.permissions @> '["role:direzione"]'::jsonb
             OR a.permissions @> '["role:developer"]'::jsonb )
  );
$$;

COMMENT ON FUNCTION public.sc_puo_operare() IS
  'System Control: vero per superadmin, role:direzione, role:developer. Nessuna email in duro (copia vendibile).';

-- ── 1. Gruppi di errore (ERROR GROUPING) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sc_error_groups (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- impronta stabile dell'errore: stessa impronta = stesso problema
  impronta              TEXT NOT NULL UNIQUE,
  titolo                TEXT NOT NULL,                 -- in italiano semplice
  messaggio_tecnico     TEXT,
  causa_probabile       TEXT,
  severita              TEXT NOT NULL DEFAULT 'medio'
                        CHECK (severita IN ('informativo','basso','medio','alto','critico')),
  categoria             TEXT NOT NULL DEFAULT 'altro',
  -- 1 = si risolve da solo, 2 = lo risolve il Super Admin, 3 = serve sviluppo
  classe_risoluzione    SMALLINT NOT NULL DEFAULT 2 CHECK (classe_risoluzione IN (1,2,3)),
  modulo                TEXT,
  funzione              TEXT,
  integrazione          TEXT,
  business              TEXT,
  azioni_suggerite      JSONB NOT NULL DEFAULT '[]'::jsonb,
  prima_comparsa        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_comparsa       TIMESTAMPTZ NOT NULL DEFAULT now(),
  occorrenze            INTEGER NOT NULL DEFAULT 0,
  aziende_coinvolte     TEXT[] NOT NULL DEFAULT '{}',
  utenti_coinvolti      TEXT[] NOT NULL DEFAULT '{}',
  stato                 TEXT NOT NULL DEFAULT 'aperto'
                        CHECK (stato IN ('aperto','in_corso','risolto','ignorato')),
  auto_tentativi        INTEGER NOT NULL DEFAULT 0,
  auto_ultimo_esito     TEXT,
  auto_ultimo_at        TIMESTAMPTZ,
  risolto_at            TIMESTAMPTZ,
  risolto_da            TEXT,
  risolto_come          TEXT,
  risolto_auto          BOOLEAN NOT NULL DEFAULT false,
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_error_groups_stato_idx    ON public.sc_error_groups (stato, severita, ultima_comparsa DESC);
CREATE INDEX IF NOT EXISTS sc_error_groups_ultima_idx   ON public.sc_error_groups (ultima_comparsa DESC);
CREATE INDEX IF NOT EXISTS sc_error_groups_integr_idx   ON public.sc_error_groups (integrazione) WHERE integrazione IS NOT NULL;

-- ── 2. Singoli eventi (ERROR HISTORY grezza) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.sc_error_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gruppo_id         UUID NOT NULL REFERENCES public.sc_error_groups(id) ON DELETE CASCADE,
  occorso_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  severita          TEXT NOT NULL DEFAULT 'medio',
  messaggio_tecnico TEXT,
  stack             TEXT,                              -- gia' sanificato
  contesto          JSONB NOT NULL DEFAULT '{}'::jsonb,-- gia' sanificato
  origine           TEXT NOT NULL DEFAULT 'server'     -- server | client | cron | webhook
                    CHECK (origine IN ('server','client','cron','webhook','database')),
  modulo            TEXT,
  funzione          TEXT,
  integrazione      TEXT,
  business          TEXT,
  sede              TEXT,
  utente_email      TEXT,
  request_id        TEXT,
  correlation_id    TEXT,
  ambiente          TEXT,
  versione          TEXT,
  durata_ms         INTEGER
);
CREATE INDEX IF NOT EXISTS sc_error_events_gruppo_idx ON public.sc_error_events (gruppo_id, occorso_at DESC);
CREATE INDEX IF NOT EXISTS sc_error_events_when_idx   ON public.sc_error_events (occorso_at DESC);

-- ── 3. Operazioni non riuscite / coda dei ritentativi ──────────────────────
-- Ogni riga e' una cosa che DOVEVA succedere e non e' successa: una fattura
-- non partita, un webhook non elaborato, un messaggio non inviato.
-- `chiave_idempotenza` e' UNIQUE: e' la garanzia anti-duplicato dei retry.
CREATE TABLE IF NOT EXISTS public.sc_operations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                  TEXT NOT NULL,                 -- fattura_sdi, webhook, email, whatsapp, cargos_sync, ...
  chiave_idempotenza    TEXT NOT NULL UNIQUE,
  descrizione           TEXT NOT NULL,
  integrazione          TEXT,
  business              TEXT,
  entita_tipo           TEXT,                          -- booking, fattura, contratto, cliente...
  entita_id             TEXT,
  -- endpoint interno da richiamare per il retry. Deve stare nella whitelist
  -- del server (systemControlCatalog.ts): mai eseguito alla cieca.
  endpoint              TEXT,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- sanificato
  stato                 TEXT NOT NULL DEFAULT 'in_coda'
                        CHECK (stato IN ('in_coda','in_corso','riuscita','fallita','abbandonata','annullata')),
  tentativi             INTEGER NOT NULL DEFAULT 0,
  max_tentativi         INTEGER NOT NULL DEFAULT 5,
  prossimo_tentativo_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_errore         TEXT,
  ultimo_errore_at      TIMESTAMPTZ,
  gruppo_id             UUID REFERENCES public.sc_error_groups(id) ON DELETE SET NULL,
  automatica            BOOLEAN NOT NULL DEFAULT true, -- false = solo retry manuale
  risolta_at            TIMESTAMPTZ,
  risolta_da            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_operations_coda_idx  ON public.sc_operations (stato, prossimo_tentativo_at);
CREATE INDEX IF NOT EXISTS sc_operations_recenti_idx ON public.sc_operations (created_at DESC);
CREATE INDEX IF NOT EXISTS sc_operations_entita_idx ON public.sc_operations (entita_tipo, entita_id);

-- ── 4. Salute delle integrazioni (INTEGRATION HEALTH) ──────────────────────
CREATE TABLE IF NOT EXISTS public.sc_integrations (
  chiave                  TEXT PRIMARY KEY,
  etichetta               TEXT NOT NULL,
  categoria               TEXT NOT NULL DEFAULT 'altro',
  business                TEXT,
  abilitata               BOOLEAN NOT NULL DEFAULT true,
  stato                   TEXT NOT NULL DEFAULT 'non_collegato'
                          CHECK (stato IN ('collegato','non_collegato','errore','credenziali_scadute',
                                           'servizio_non_disponibile','sincronizzazione','disabilitata')),
  ultimo_test_at          TIMESTAMPTZ,
  ultimo_test_ok          BOOLEAN,
  ultimo_test_messaggio   TEXT,
  ultima_sync_at          TIMESTAMPTZ,
  ultimo_errore           TEXT,
  ultimo_errore_at        TIMESTAMPTZ,
  ultima_chiamata_ok_at   TIMESTAMPTZ,
  fallimenti_consecutivi  INTEGER NOT NULL DEFAULT 0,
  chiamate_ok             BIGINT  NOT NULL DEFAULT 0,
  chiamate_ko             BIGINT  NOT NULL DEFAULT 0,
  latenza_media_ms        INTEGER NOT NULL DEFAULT 0,
  -- interruttore automatico: chiuso = passa, aperto = fermo, semiaperto = prova
  circuito                TEXT NOT NULL DEFAULT 'chiuso'
                          CHECK (circuito IN ('chiuso','aperto','semiaperto')),
  circuito_fino_a         TIMESTAMPTZ,
  note                    TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. Audit di ogni intervento fatto dal System Control ───────────────────
CREATE TABLE IF NOT EXISTS public.sc_actions_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  azione          TEXT NOT NULL,
  attore_email    TEXT,
  attore_nome     TEXT,
  automatico      BOOLEAN NOT NULL DEFAULT false,
  bersaglio_tipo  TEXT,
  bersaglio_id    TEXT,
  business        TEXT,
  problema        TEXT,
  parametri       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- sanificato
  esito           TEXT NOT NULL DEFAULT 'ok' CHECK (esito IN ('ok','errore','rifiutata')),
  messaggio       TEXT,
  durata_ms       INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_actions_log_when_idx ON public.sc_actions_log (created_at DESC);

-- ── 6. Storico delle configurazioni (CONFIGURATION HISTORY) ────────────────
CREATE TABLE IF NOT EXISTS public.sc_config_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tabella         TEXT NOT NULL,
  riga_id         TEXT NOT NULL,
  etichetta       TEXT,
  prima           JSONB,
  dopo            JSONB,
  modificato_da   TEXT,
  ripristinabile  BOOLEAN NOT NULL DEFAULT true,
  ripristinato_at TIMESTAMPTZ,
  ripristinato_da TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_config_history_riga_idx ON public.sc_config_history (tabella, riga_id, created_at DESC);

-- ── 7. Interruttori funzione + manutenzione (KILL SWITCH / MAINTENANCE) ────
-- business = '*' significa "tutte le aziende". Niente NULL, cosi' la chiave
-- unica funziona su ogni versione di Postgres.
CREATE TABLE IF NOT EXISTS public.sc_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chiave        TEXT NOT NULL,
  business      TEXT NOT NULL DEFAULT '*',
  attiva        BOOLEAN NOT NULL DEFAULT true,      -- false = funzione spenta
  manutenzione  BOOLEAN NOT NULL DEFAULT false,
  messaggio     TEXT,
  motivo        TEXT,
  aggiornato_da TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chiave, business)
);

-- ── 8. Rapporti tecnici per lo sviluppatore (CATEGORIA 3) ──────────────────
CREATE TABLE IF NOT EXISTS public.sc_incidents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              TEXT NOT NULL UNIQUE,
  titolo              TEXT NOT NULL,
  gravita             TEXT NOT NULL DEFAULT 'alto'
                      CHECK (gravita IN ('informativo','basso','medio','alto','critico')),
  stato               TEXT NOT NULL DEFAULT 'aperto'
                      CHECK (stato IN ('aperto','in_lavorazione','chiuso')),
  gruppo_id           UUID REFERENCES public.sc_error_groups(id) ON DELETE SET NULL,
  ambiente            TEXT,
  versione            TEXT,
  modulo              TEXT,
  integrazione        TEXT,
  business            TEXT,
  passi               TEXT,
  messaggio_errore    TEXT,
  stack               TEXT,
  request_id          TEXT,
  correlation_id      TEXT,
  log_pertinenti      JSONB NOT NULL DEFAULT '[]'::jsonb,
  frequenza           INTEGER NOT NULL DEFAULT 0,
  utenti_interessati  INTEGER NOT NULL DEFAULT 0,
  ultimo_deploy       TEXT,
  ultimo_deploy_at    TIMESTAMPTZ,
  corpo_markdown      TEXT,
  creato_da           TEXT,
  chiuso_at           TIMESTAMPTZ,
  chiuso_da           TEXT,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 9. Prestazioni (PERFORMANCE), aggregate per ora ────────────────────────
CREATE TABLE IF NOT EXISTS public.sc_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            TEXT NOT NULL CHECK (tipo IN ('funzione','query','pagina','integrazione','job')),
  nome            TEXT NOT NULL,
  business        TEXT NOT NULL DEFAULT '*',
  ora             TIMESTAMPTZ NOT NULL,
  chiamate        INTEGER NOT NULL DEFAULT 0,
  errori          INTEGER NOT NULL DEFAULT 0,
  durata_totale_ms BIGINT NOT NULL DEFAULT 0,
  durata_max_ms   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tipo, nome, business, ora)
);
CREATE INDEX IF NOT EXISTS sc_metrics_ora_idx ON public.sc_metrics (ora DESC);

-- ── 10. Rilasci (RELEASE MONITORING) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sc_releases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  versione        TEXT NOT NULL,
  commit_sha      TEXT,
  ambiente        TEXT NOT NULL DEFAULT 'production',
  rilasciato_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  errori_prima    INTEGER,
  errori_dopo     INTEGER,
  esito           TEXT NOT NULL DEFAULT 'in_osservazione'
                  CHECK (esito IN ('in_osservazione','stabile','peggiorato')),
  note            TEXT
);
CREATE INDEX IF NOT EXISTS sc_releases_when_idx ON public.sc_releases (rilasciato_at DESC);

-- ── 11. Avvisi inviati (anti-spam degli ALERT) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.sc_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chiave        TEXT NOT NULL,
  gruppo_id     UUID REFERENCES public.sc_error_groups(id) ON DELETE SET NULL,
  severita      TEXT,
  titolo        TEXT,
  messaggio     TEXT,
  canale        TEXT,
  destinatari   TEXT,
  eventi_raggruppati INTEGER NOT NULL DEFAULT 1,
  inviato_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  letto_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sc_alerts_chiave_idx ON public.sc_alerts (chiave, inviato_at DESC);

-- ── 12. Stato dei backup ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sc_backups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          TEXT NOT NULL DEFAULT 'database',
  eseguito_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  esito         TEXT NOT NULL DEFAULT 'ok' CHECK (esito IN ('ok','errore','sconosciuto')),
  dimensione_mb NUMERIC,
  posizione     TEXT,
  messaggio     TEXT,
  verificato_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sc_backups_when_idx ON public.sc_backups (eseguito_at DESC);

-- ── RLS: lettura e scrittura solo a direzione/developer/superadmin ─────────
-- Il service role (Netlify functions) bypassa sempre le policy: e' lui che
-- scrive gli errori. Dal browser si legge, e si scrive solo cio' che la tab
-- deve poter marcare (stato di un gruppo, note).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sc_error_groups','sc_error_events','sc_operations','sc_integrations',
    'sc_actions_log','sc_config_history','sc_flags','sc_incidents',
    'sc_metrics','sc_releases','sc_alerts','sc_backups'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.sc_puo_operare())',
      t || '_sel', t);
  END LOOP;
END $$;

-- Le uniche scritture consentite dal browser: cambiare stato/note di un
-- problema e degli incidenti. Tutto il resto passa dalle Netlify functions,
-- che girano con service role e registrano l'audit.
DROP POLICY IF EXISTS sc_error_groups_upd ON public.sc_error_groups;
CREATE POLICY sc_error_groups_upd ON public.sc_error_groups
  FOR UPDATE TO authenticated USING (public.sc_puo_operare()) WITH CHECK (public.sc_puo_operare());

DROP POLICY IF EXISTS sc_incidents_upd ON public.sc_incidents;
CREATE POLICY sc_incidents_upd ON public.sc_incidents
  FOR UPDATE TO authenticated USING (public.sc_puo_operare()) WITH CHECK (public.sc_puo_operare());

-- ── Catalogo iniziale delle integrazioni ───────────────────────────────────
-- Righe create solo se mancanti: rieseguire il file non azzera gli stati.
INSERT INTO public.sc_integrations (chiave, etichetta, categoria) VALUES
  ('supabase',      'Database (Supabase)',            'infrastruttura'),
  ('auth',          'Autenticazione',                 'infrastruttura'),
  ('storage',       'Archivio file',                  'infrastruttura'),
  ('nexi',          'Pagamenti Nexi',                 'pagamenti'),
  ('aruba_sdi',     'Fatturazione elettronica (SDI)', 'fatturazione'),
  ('pec',           'PEC',                            'comunicazione'),
  ('email',         'E-mail',                         'comunicazione'),
  ('green_api',     'WhatsApp (Green API)',           'comunicazione'),
  ('trustera',      'Firma elettronica (DR7 Trust)',  'documenti'),
  ('cargos',        'CARGOS',                         'adempimenti'),
  ('openapi_targhe','Visure targhe (OpenAPI)',        'dati'),
  ('gps',           'GPS flotta',                     'dati'),
  ('google_gbp',    'Google Business Profile',        'dati'),
  ('meteo',         'Meteo (Open-Meteo)',             'dati'),
  ('netlify',       'Funzioni e deploy (Netlify)',    'infrastruttura')
ON CONFLICT (chiave) DO NOTHING;

-- ── Verifica ───────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE 'sc_%'
 ORDER BY table_name;
