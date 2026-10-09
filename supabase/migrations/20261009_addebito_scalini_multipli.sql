-- 09/10/2026: piu' scalini per la cascata addebito, scelti per-transazione.
-- Lista ordinata in centesimi, dal piu' grande (es. [1000000, 500000, 200000]
-- = 10.000 / 5.000 / 2.000 EUR). NULL = vecchia cascata a scalino unico
-- (cascade_step_cents), che resta invariata.
ALTER TABLE public.pending_addebiti
  ADD COLUMN IF NOT EXISTS cascade_steps_cents jsonb;

COMMENT ON COLUMN public.pending_addebiti.cascade_steps_cents IS
  'Scalini della cascata addebito in centesimi, dal piu grande. NULL = scalino unico cascade_step_cents.';
