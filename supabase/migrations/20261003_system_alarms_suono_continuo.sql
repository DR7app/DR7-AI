-- 03/10/2026: ripetizione del suono per ogni allarme (Centralina Pro > Allarmi).
-- true  = il suono continua finche' la finestra dell'allarme non si chiude
-- false = suona una volta sola
-- Default true: e' quello che la direzione si aspetta ("la ca fait juste un bip").
ALTER TABLE public.system_alarms
  ADD COLUMN IF NOT EXISTS suono_continuo BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.system_alarms.suono_continuo IS
  'true = suono in loop finche'' la finestra non si chiude; false = una volta sola.';

NOTIFY pgrst, 'reload schema';

SELECT count(*) AS allarmi, count(*) FILTER (WHERE suono_continuo) AS continui FROM public.system_alarms;
