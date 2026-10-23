-- ============================================================================
-- IMMONDIZIA: RITIRO OGNI 2 SETTIMANE E OGNI MESE (23/10/2026)
--
-- Prima solo 'weekly' (giorno fisso) e 'date' (data singola). Nuovi modi:
--  - 'biweekly': ogni 14 giorni a partire da pickup_date (primo ritiro);
--                day_of_week = giorno della settimana di pickup_date.
--  - 'monthly' : ogni mese lo stesso giorno di pickup_date (se il mese e'
--                piu' corto, l'ultimo giorno del mese), a partire da pickup_date.
-- Calcolo in netlify/functions/immondizia-reminder-cron.ts.
-- ============================================================================

ALTER TABLE public.immondizia_calendario
  DROP CONSTRAINT IF EXISTS immondizia_calendario_mode_check;

ALTER TABLE public.immondizia_calendario
  ADD CONSTRAINT immondizia_calendario_mode_check
  CHECK (mode IN ('weekly', 'biweekly', 'monthly', 'date'));
