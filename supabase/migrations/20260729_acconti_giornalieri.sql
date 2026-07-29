-- #42 Acconti — registrazione degli acconti incassati nella giornata dagli
-- operatori. Ogni operatore registra quanto ha incassato (contanti/altro) con
-- causale e nota; la direzione vede il riepilogo per giornata.
CREATE TABLE IF NOT EXISTS public.acconti_giornalieri (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operatore_id   UUID,                                   -- admins.id di chi ha incassato
  operatore_nome TEXT,                                   -- denormalizzato per il display
  data           DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Rome')::date,
  importo_cents  INTEGER NOT NULL CHECK (importo_cents > 0),
  causale        TEXT,
  note           TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acconti_data ON public.acconti_giornalieri(data);
CREATE INDEX IF NOT EXISTS idx_acconti_operatore ON public.acconti_giornalieri(operatore_id);

ALTER TABLE public.acconti_giornalieri ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acconti_all ON public.acconti_giornalieri;
CREATE POLICY acconti_all ON public.acconti_giornalieri
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
