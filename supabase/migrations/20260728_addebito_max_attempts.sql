-- Addebito: parametri scelti PER-TRANSAZIONE al momento dell'addebito.
--  - max_attempts:       la cascata si FERMA dopo N tentativi totali (NULL = illimitato).
--  - cascade_step_cents: scalino della cascata in centesimi (NULL/0 = default €300).
-- La cascata scende dello scalino ad ogni rifiuto e si ferma quando la carta
-- accetta, quando scende sotto il minimo, o quando raggiunge max_attempts.
ALTER TABLE public.pending_addebiti
  ADD COLUMN IF NOT EXISTS max_attempts integer;
ALTER TABLE public.pending_addebiti
  ADD COLUMN IF NOT EXISTS cascade_step_cents integer;

COMMENT ON COLUMN public.pending_addebiti.max_attempts IS
  'Numero massimo di tentativi di addebito nella cascata (per-transazione). NULL = illimitato.';
COMMENT ON COLUMN public.pending_addebiti.cascade_step_cents IS
  'Scalino della cascata addebito in centesimi (per-transazione). NULL/0 = default 30000 (€300).';
