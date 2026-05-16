-- Aggiunge il saldo "ore a recuperare" per ciascun operatore.
--
-- Valore in MINUTI (intero, anche negativo). Convenzione:
--   > 0 = l'operatore deve recuperare queste ore (es. assenza non
--         giustificata che decurta la paga)
--   < 0 = l'azienda deve riconoscere ore extra all'operatore
--   = 0 = nessun aggiustamento
--
-- Il Calcola Paga nel profilo operatore tratta questo valore come
-- un offset diretto sui minuti lavorati prima di moltiplicare per la
-- paga oraria.

ALTER TABLE public.operatori_persone
    ADD COLUMN IF NOT EXISTS ore_a_recuperare_min integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.operatori_persone.ore_a_recuperare_min IS
    'Saldo minuti da recuperare (positivo = operatore deve recuperare, negativo = azienda deve riconoscere). Usato dal Calcola Paga.';
