-- 13/10/2026: punto in cui la cascata addebito si e' fermata per tempo
-- (Netlify chiude la funzione a 30s). Il giro successivo riprende da qui
-- invece di ripartire dall'importo pieno. NULL = nessuna cascata in corso.
-- Caso Concas: senza questo ogni giro moriva a meta' e ripartiva da capo,
-- 338 tentativi in 5 minuti.
ALTER TABLE public.pending_addebiti
  ADD COLUMN IF NOT EXISTS cascade_state jsonb;

COMMENT ON COLUMN public.pending_addebiti.cascade_state IS
  'Ripresa cascata scalini: {cardIndex, livello, amount, ultimoRifiutato}. NULL = nessuna cascata in corso.';
