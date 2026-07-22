-- =============================================================================
-- Avviso automatico "Scadenza cauzione" + dati bancari di restituzione
-- Specifica DR7 v1.0 (22/07/2026). FASE 1 (schema) + config + log/audit.
-- Riusa i campi gia' presenti su cauzioni (iban, intestatario_conto,
-- scadenza_cauzione, importo). Aggiunge i campi mancanti della "scheda
-- restituzione", il parametro giorni configurabile, il log invii, l'audit IBAN
-- e l'IBAN in anagrafica cliente per la precompilazione.
-- =============================================================================

-- ── FASE 1: nuovi campi "Dati per la restituzione" su cauzioni ───────────────
ALTER TABLE public.cauzioni
  ADD COLUMN IF NOT EXISTS intestatario_diverso_da_cliente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS motivo_intestatario_diverso     TEXT,
  ADD COLUMN IF NOT EXISTS banca                           TEXT,
  ADD COLUMN IF NOT EXISTS bic_swift                       TEXT,
  ADD COLUMN IF NOT EXISTS importo_trattenuto              NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_restituzione_effettiva     DATE,
  ADD COLUMN IF NOT EXISTS riferimento_bonifico            TEXT,
  -- FASE 3: se un operatore modifica a mano la scadenza, il ricalcolo automatico
  -- non la tocca piu'.
  ADD COLUMN IF NOT EXISTS scadenza_forzata_manualmente    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Stato restituzione: dimensione PARALLELA a `stato` (che governa il ciclo
  -- vita della cauzione). Non tocchiamo `stato` per non rompere la logica
  -- esistente (trigger auto-delete, ecc.).
  ADD COLUMN IF NOT EXISTS stato_restituzione TEXT NOT NULL DEFAULT 'DA_RESTITUIRE'
    CHECK (stato_restituzione IN ('DA_RESTITUIRE','RESTITUITA','TRATTENUTA_PARZIALE','TRATTENUTA_TOTALE','NON_DOVUTA'));

COMMENT ON COLUMN public.cauzioni.stato_restituzione IS 'Workflow rimborso (parallelo a stato): DA_RESTITUIRE/RESTITUITA/TRATTENUTA_PARZIALE/TRATTENUTA_TOTALE/NON_DOVUTA';
COMMENT ON COLUMN public.cauzioni.scadenza_forzata_manualmente IS 'Se true la scadenza e stata impostata a mano: il ricalcolo automatico non la sovrascrive';

-- ── IBAN in anagrafica cliente (precompilazione ultima volta) ────────────────
ALTER TABLE public.customers_extended
  ADD COLUMN IF NOT EXISTS iban TEXT,
  ADD COLUMN IF NOT EXISTS iban_intestatario TEXT;
COMMENT ON COLUMN public.customers_extended.iban IS 'Ultimo IBAN usato per rimborso cauzione — precompila la prossima cauzione dello stesso cliente';

-- ── Config cauzioni (singleton) — FASE 3 & 4 parametri di Centralina PRO ─────
CREATE TABLE IF NOT EXISTS public.cauzioni_config (
  id                         TEXT PRIMARY KEY DEFAULT 'main',
  giorni_restituzione_default INTEGER NOT NULL DEFAULT 15,
  giorni_restituzione_terra   INTEGER,   -- override per business; NULL = usa default
  giorni_restituzione_mare    INTEGER,
  giorni_restituzione_altro   INTEGER,
  sposta_giorno_lavorativo    BOOLEAN NOT NULL DEFAULT FALSE,  -- nasce DISATTIVATA
  orario_invio                SMALLINT NOT NULL DEFAULT 8,     -- 08:00 Europe/Rome
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.cauzioni_config (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;

-- ── FASE 9: registro invii "Scadenza cauzione" (+ anti-duplicato a DB) ───────
CREATE TABLE IF NOT EXISTS public.cauzioni_scadenza_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cauzione_id     UUID REFERENCES public.cauzioni(id) ON DELETE CASCADE,
  message_code    TEXT NOT NULL DEFAULT 'SCADENZA_CAUZIONE',
  variante        TEXT NOT NULL CHECK (variante IN ('A','B','C')),
  destinatari     TEXT,
  canali          TEXT,
  esito           JSONB,
  chiave_antidup  TEXT NOT NULL,                 -- SCADENZA_CAUZIONE:{id}:{YYYY-MM-DD}
  gestita_da      TEXT,
  gestita_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- OBBLIGATORIO (spec): l'anti-duplicato e' un vincolo di DB, non solo codice.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cauzioni_scadenza_antidup
  ON public.cauzioni_scadenza_log(chiave_antidup);
CREATE INDEX IF NOT EXISTS idx_cauzioni_scadenza_log_cauzione
  ON public.cauzioni_scadenza_log(cauzione_id, created_at DESC);

-- ── FASE 9: audit IBAN (valori mascherati) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cauzioni_iban_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cauzione_id    UUID REFERENCES public.cauzioni(id) ON DELETE CASCADE,
  campo          TEXT NOT NULL,                  -- iban | intestatario_conto | bic_swift
  valore_prima   TEXT,                           -- SEMPRE mascherato
  valore_dopo    TEXT,                           -- SEMPRE mascherato
  utente         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cauzioni_iban_audit_cauzione
  ON public.cauzioni_iban_audit(cauzione_id, created_at DESC);

-- ── RLS coerente con gli altri moduli admin ─────────────────────────────────
ALTER TABLE public.cauzioni_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cauzioni_scadenza_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cauzioni_iban_audit    ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cauzioni_config','cauzioni_scadenza_log','cauzioni_iban_audit'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- ── Anti-doppio-invio giornaliero a livello riga (oltre alla chiave log) ─────
ALTER TABLE public.cauzioni
  ADD COLUMN IF NOT EXISTS scadenza_avviso_sent_on DATE;
COMMENT ON COLUMN public.cauzioni.scadenza_avviso_sent_on IS 'Data (Rome) ultimo avviso Scadenza Cauzione inviato — evita doppio invio giornaliero';
