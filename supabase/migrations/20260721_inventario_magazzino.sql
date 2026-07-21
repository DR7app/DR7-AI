-- =============================================================================
-- Modulo Inventario / Magazzino Generale (company-wide warehouse)
-- Distinto dal magazzino ricambi-veicolo (fleet_vehicle_inventory).
-- 6 entita: inv_categorie, inv_articoli, inv_movimenti, inv_ordini,
-- inv_audit_log + estensione di public.fornitori (canale_riordino_default).
-- Regola chiave: giacenza <= soglia_minima -> parte un riordino (WhatsApp/
-- Email/Amazon/Manuale) + ALARM allo staff. Un solo ordine aperto per articolo
-- (unique partial index). Il ledger movimenti e' append-only.
-- =============================================================================

-- ── Fornitori: canale di riordino predefinito ────────────────────────────────
ALTER TABLE public.fornitori
  ADD COLUMN IF NOT EXISTS canale_riordino_default TEXT
    CHECK (canale_riordino_default IN ('whatsapp','email','amazon','manuale'));

-- ── 1. Categorie (17 sottosezioni) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_categorie (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice      TEXT NOT NULL UNIQUE,          -- CAF, PUL, LUB...
  nome        TEXT NOT NULL,
  ordine      INTEGER NOT NULL DEFAULT 0,
  attiva      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Articoli ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_articoli (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice             TEXT NOT NULL UNIQUE,   -- DR7-CAF-002
  categoria_codice   TEXT NOT NULL REFERENCES public.inv_categorie(codice) ON UPDATE CASCADE,
  nome               TEXT NOT NULL,
  quantita           NUMERIC(12,2) NOT NULL DEFAULT 0,
  unita              TEXT,                   -- pezzi, bottiglie, litri...
  giacenza_pct       NUMERIC(5,2),           -- SOLO contenitori a riempimento (LAV) 0..100
  prezzo             NUMERIC(12,2),          -- prezzo unitario (IVA inclusa), fillable
  soglia_minima      NUMERIC(12,2),          -- riordino quando quantita <= soglia
  quantita_riordino  NUMERIC(12,2),          -- quanto ordinare al trigger
  fornitore_id       UUID REFERENCES public.fornitori(id) ON DELETE SET NULL,
  canale_riordino    TEXT CHECK (canale_riordino IN ('whatsapp','email','amazon','manuale')),
  amazon_asin        TEXT,
  amazon_url         TEXT,
  note               TEXT,
  attivo             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID,
  updated_by         UUID
);
CREATE INDEX IF NOT EXISTS idx_inv_articoli_categoria ON public.inv_articoli(categoria_codice);
CREATE INDEX IF NOT EXISTS idx_inv_articoli_fornitore ON public.inv_articoli(fornitore_id);

-- ── 3. Movimenti (ledger append-only) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_movimenti (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articolo_id  UUID NOT NULL REFERENCES public.inv_articoli(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('carico','scarico','rettifica','riordino')),
  delta        NUMERIC(12,2),               -- con segno; NULL per riordino (evento)
  qta_prima    NUMERIC(12,2),
  qta_dopo     NUMERIC(12,2),
  motivo       TEXT,
  utente       TEXT,                        -- email/nome operatore
  ordine_id    UUID,                        -- eventuale riordino collegato
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_movimenti_articolo ON public.inv_movimenti(articolo_id, created_at DESC);

-- ── 4. Ordini di riordino ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_ordini (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articolo_id      UUID NOT NULL REFERENCES public.inv_articoli(id) ON DELETE CASCADE,
  fornitore_id     UUID REFERENCES public.fornitori(id) ON DELETE SET NULL,
  canale           TEXT NOT NULL DEFAULT 'whatsapp'
                     CHECK (canale IN ('whatsapp','email','amazon','manuale')),
  quantita         NUMERIC(12,2) NOT NULL,
  stato            TEXT NOT NULL DEFAULT 'bozza'
                     CHECK (stato IN ('bozza','inviato','confermato','ricevuto','annullato')),
  amazon_order_id  TEXT,
  auto             BOOLEAN NOT NULL DEFAULT FALSE,   -- creato dal trigger soglia
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ,
  received_at      TIMESTAMPTZ,
  created_by       UUID
);
CREATE INDEX IF NOT EXISTS idx_inv_ordini_articolo ON public.inv_ordini(articolo_id);
-- Un SOLO ordine aperto (bozza/inviato/confermato) per articolo: blocca la
-- raffica di ordini quando la giacenza resta sotto soglia (Step 5.3).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inv_ordine_aperto_per_articolo
  ON public.inv_ordini(articolo_id)
  WHERE stato IN ('bozza','inviato','confermato');

-- ── 5. Audit log (storico strutturale) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entita         TEXT NOT NULL,              -- articolo, categoria, fornitore, ordine
  entita_id      UUID,
  azione         TEXT NOT NULL CHECK (azione IN ('crea','modifica','elimina')),
  campo          TEXT,
  valore_prima   TEXT,
  valore_dopo    TEXT,
  utente         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_audit_entita ON public.inv_audit_log(entita, entita_id, created_at DESC);

-- ── RPC atomico: applica un movimento e aggiorna la giacenza sotto lock ──────
-- Ritorna la nuova quantita e un flag "sotto_soglia" (giacenza <= soglia).
-- La app, se sotto_soglia e nessun ordine aperto, crea l'ordine + manda l'ALARM.
-- Il lock (FOR UPDATE) serializza scarichi concorrenti (Step 5 "atomico").
CREATE OR REPLACE FUNCTION public.inv_apply_movimento(
  p_articolo_id UUID,
  p_tipo        TEXT,          -- carico | scarico | rettifica
  p_valore      NUMERIC,       -- carico/scarico: quantita (positiva); rettifica: valore reale
  p_motivo      TEXT,
  p_utente      TEXT
) RETURNS TABLE (nuova_quantita NUMERIC, sotto_soglia BOOLEAN, soglia NUMERIC, is_pct BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prima  NUMERIC;
  v_dopo   NUMERIC;
  v_delta  NUMERIC;
  v_soglia NUMERIC;
  v_is_pct BOOLEAN;
BEGIN
  SELECT
    CASE WHEN giacenza_pct IS NOT NULL THEN giacenza_pct ELSE quantita END,
    soglia_minima,
    (giacenza_pct IS NOT NULL)
  INTO v_prima, v_soglia, v_is_pct
  FROM public.inv_articoli
  WHERE id = p_articolo_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Articolo % non trovato', p_articolo_id;
  END IF;

  IF p_tipo = 'carico' THEN
    v_dopo := v_prima + ABS(p_valore);
  ELSIF p_tipo = 'scarico' THEN
    v_dopo := GREATEST(0, v_prima - ABS(p_valore));
  ELSIF p_tipo = 'rettifica' THEN
    v_dopo := GREATEST(0, p_valore);
  ELSE
    RAISE EXCEPTION 'Tipo movimento non valido: %', p_tipo;
  END IF;
  v_delta := v_dopo - v_prima;

  IF v_is_pct THEN
    UPDATE public.inv_articoli
       SET giacenza_pct = LEAST(100, v_dopo), updated_at = NOW()
     WHERE id = p_articolo_id;
  ELSE
    UPDATE public.inv_articoli
       SET quantita = v_dopo, updated_at = NOW()
     WHERE id = p_articolo_id;
  END IF;

  INSERT INTO public.inv_movimenti(articolo_id, tipo, delta, qta_prima, qta_dopo, motivo, utente)
  VALUES (p_articolo_id, p_tipo, v_delta, v_prima, v_dopo, p_motivo, p_utente);

  RETURN QUERY SELECT
    v_dopo,
    (v_soglia IS NOT NULL AND v_dopo <= v_soglia),
    v_soglia,
    v_is_pct;
END;
$$;

-- ── RLS: lettura a authenticated, scrittura a authenticated (allineato agli
-- altri moduli admin). Le RPC girano SECURITY DEFINER. ─────────────────────
ALTER TABLE public.inv_categorie  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_articoli   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_movimenti  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_ordini     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inv_audit_log  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['inv_categorie','inv_articoli','inv_movimenti','inv_ordini','inv_audit_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t, t);
  END LOOP;
END $$;

-- ── Seed 17 categorie ───────────────────────────────────────────────────────
INSERT INTO public.inv_categorie (codice, nome, ordine) VALUES
  ('CAF','Caffetteria e Area Clienti',1),
  ('PUL','Pulizia e Igiene',2),
  ('DPI','DPI e Materiale Operativo',3),
  ('UFF','Materiale Ufficio',4),
  ('MKT','Marketing e Allestimenti',5),
  ('SNK','Snack',6),
  ('LUB','Meccanica · Lubrificanti e Fluidi',7),
  ('VER','Vernici e Materiali per Manutenzione',8),
  ('ABB','Abbigliamento',9),
  ('ARR','Arredi ed Esposizione',10),
  ('RIC','Ricambi e Accessori Veicoli',11),
  ('FRE','Ricambi Veicoli · Pastiglie Freno',12),
  ('LAV','Prodotti Lavaggio',13),
  ('BOM','Bombolette e Confezioni',14),
  ('FIL','Ricambi Veicoli · Filtri',15),
  ('ELE','Materiale Elettrico',16),
  ('CAN','Cancelleria e Materiale di Consumo',17)
ON CONFLICT (codice) DO UPDATE SET nome = EXCLUDED.nome, ordine = EXCLUDED.ordine;
