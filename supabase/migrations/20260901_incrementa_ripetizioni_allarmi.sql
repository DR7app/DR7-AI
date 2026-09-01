-- 01/09/2026 — Allarmi: un solo viaggio per incrementare i contatori.
--
-- Il motore, a ogni giro, riconta quante volte una condizione e' ancora vera
-- e scrive il nuovo numero su ogni occorrenza ancora aperta. Lo faceva con
-- una UPDATE PER RIGA: con 845 occorrenze aperte erano centinaia di richieste
-- in fila, ripetute a ogni apertura del gestionale da ogni operatore.
--
-- Qui l'incremento avviene dentro il database in un colpo solo: si passa
-- l'elenco delle occorrenze e ognuna sale di uno. Nessuna riga cambia valore
-- in modo diverso da prima — cambia solo che si scrive tutto insieme.
--
-- `+1` viene calcolato dal database sul valore corrente, non dal browser:
-- due schede aperte che fanno il giro nello stesso istante non si sovrascrivono
-- piu' a vicenda con lo stesso numero.

CREATE OR REPLACE FUNCTION public.incrementa_ripetizioni_allarmi(ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.alarm_events
     SET ripetizioni = COALESCE(ripetizioni, 0) + 1
   WHERE id = ANY(ids)
     AND stato = 'aperto';
$$;

COMMENT ON FUNCTION public.incrementa_ripetizioni_allarmi(uuid[]) IS
  'Alza di uno il contatore ripetizioni delle occorrenze allarme ancora aperte, in una sola richiesta.';

GRANT EXECUTE ON FUNCTION public.incrementa_ripetizioni_allarmi(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.incrementa_ripetizioni_allarmi(uuid[]) TO service_role;
