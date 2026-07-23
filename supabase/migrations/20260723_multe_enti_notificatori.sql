-- =============================================================================
-- Multe — Destinatario PEC dinamico (spec 23/07/2026) · FASE 1
-- Rubrica enti accertatori (enti_notificatori) + estensione del log invii
-- (multe_pec_log riusato al posto di multe_invii_pec per non duplicare la
-- history esistente). Fonte dati: IPA (sync server-side) + inserimento manuale
-- + PEC letta dal verbale. NIENTE PEC hardcoded nel codice: il default Cagliari
-- diventa una riga di rubrica (fonte manuale, verificata).
-- =============================================================================

-- pg_trgm per il fuzzy match (trigram similarity) sulla denominazione.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Rubrica enti accertatori ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.enti_notificatori (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  denominazione  TEXT NOT NULL,                 -- "Comando Polizia Locale di Quartu Sant'Elena"
  tipo_ente      TEXT NOT NULL DEFAULT 'altro'
                   CHECK (tipo_ente IN ('polizia_locale','polizia_stradale','carabinieri','gdf','polizia_provinciale','concessionaria','altro')),
  comune         TEXT,
  provincia      TEXT,                          -- sigla, es. "CA"
  regione        TEXT,
  codice_ipa     TEXT UNIQUE,                   -- codice univoco IPA (null se manuale)
  pec            TEXT NOT NULL,
  email          TEXT,
  indirizzo      TEXT,
  fonte          TEXT NOT NULL DEFAULT 'ipa' CHECK (fonte IN ('ipa','manuale','verbale')),
  verificata_il  TIMESTAMPTZ,
  attivo         BOOLEAN NOT NULL DEFAULT TRUE,
  note           TEXT,
  creato_il      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aggiornato_il  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Ricerca full-text + trigram su denominazione/comune (autocomplete rubrica).
CREATE INDEX IF NOT EXISTS idx_enti_ricerca_trgm
  ON public.enti_notificatori USING gin ((denominazione || ' ' || COALESCE(comune,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_enti_provincia ON public.enti_notificatori(provincia) WHERE attivo;
-- Una sola riga per (denominazione, comune) di fonte manuale/verbale (evita doppioni da uso).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_enti_denominazione_comune
  ON public.enti_notificatori(lower(denominazione), lower(COALESCE(comune,'')))
  WHERE codice_ipa IS NULL;

-- ── Estensione log invii PEC (multe_pec_log) ────────────────────────────────
ALTER TABLE public.multe_pec_log
  ADD COLUMN IF NOT EXISTS ente_id            UUID REFERENCES public.enti_notificatori(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modalita_selezione TEXT CHECK (modalita_selezione IN ('automatica','rubrica','manuale','verbale')),
  ADD COLUMN IF NOT EXISTS confidenza         NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS pec_cc             TEXT[];

-- ── RLS coerente con gli altri moduli admin ─────────────────────────────────
ALTER TABLE public.enti_notificatori ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enti_notificatori_all ON public.enti_notificatori;
CREATE POLICY enti_notificatori_all ON public.enti_notificatori
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Seed: SOLO l'ente Cagliari (ex-hardcoded, PEC verificata). Il resto della
-- rubrica si popola via sync IPA + inserimento manuale + PEC dal verbale.
-- Non seminiamo PEC non verificate: una PEC errata = comunicazione non
-- effettuata + sanzione a carico DR7. ────────────────────────────────────────
INSERT INTO public.enti_notificatori (denominazione, tipo_ente, comune, provincia, regione, pec, fonte, verificata_il, note)
VALUES (
  'Polizia Locale di Cagliari', 'polizia_locale', 'Cagliari', 'CA', 'Sardegna',
  'poliziamunicipale@comune.cagliari.legalmail.it', 'manuale', NOW(),
  'Destinatario storico DR7 (ex default hardcoded). PEC verificata.'
)
ON CONFLICT DO NOTHING;
