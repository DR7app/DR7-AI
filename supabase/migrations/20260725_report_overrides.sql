-- Modifiche manuali ai report (nuova funzione). Layer di override applicato sopra
-- i report calcolati: correggi un valore, rimuovi una voce in piu', aggiungi una
-- voce mancante — con nota/motivo e tracciabilita'. Vale per tutti i report
-- (report_type: noleggio | penali_danni | lavaggio | clienti | ...).
CREATE TABLE IF NOT EXISTS public.report_overrides (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type  TEXT NOT NULL,                       -- noleggio | penali_danni | lavaggio | clienti
  row_key      TEXT NOT NULL,                       -- id stabile della riga (es. booking_id) o 'manual_<uuid>'
  action       TEXT NOT NULL CHECK (action IN ('edit','remove','add')),
  field        TEXT,                                -- campo numerico da sovrascrivere (per 'edit')
  value_num    NUMERIC,                             -- valore override (per 'edit')
  value_json   JSONB,                               -- riga sintetica completa (per 'add')
  note         TEXT,                                -- motivo della modifica
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Un solo override per (report, riga, campo). Per 'remove' si usa il sentinel
-- field='__remove__'; per 'add' field resta NULL (row_key unico -> nessun
-- conflitto). Indice su colonne reali cosi' l'upsert onConflict funziona.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_report_override
  ON public.report_overrides(report_type, row_key, field);
CREATE INDEX IF NOT EXISTS idx_report_overrides_type ON public.report_overrides(report_type);

ALTER TABLE public.report_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_overrides_all ON public.report_overrides;
CREATE POLICY report_overrides_all ON public.report_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
