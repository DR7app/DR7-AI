-- Fix: Salvatore non ha ore da recuperare ma il sistema mostra -€700
-- perche' il campo `ore_a_recuperare_min` ha un valore residuo (da
-- inserimento manuale precedente).
--
-- Step 1: verifica il valore attuale (potrebbe essere 6000 = 100h × €7/h)
SELECT id, nome, cognome, ore_a_recuperare_min,
       (ore_a_recuperare_min / 60.0) AS ore_recupero
FROM public.operatori_persone
WHERE LOWER(nome) LIKE 'salvatore%' OR LOWER(cognome) LIKE 'salvatore%';

-- Step 2: azzera il saldo (decommenta dopo aver verificato)
/*
UPDATE public.operatori_persone
SET ore_a_recuperare_min = 0
WHERE LOWER(nome) LIKE 'salvatore%' OR LOWER(cognome) LIKE 'salvatore%';
*/

-- Step 3: verifica finale
SELECT id, nome, cognome, ore_a_recuperare_min
FROM public.operatori_persone
WHERE LOWER(nome) LIKE 'salvatore%' OR LOWER(cognome) LIKE 'salvatore%';
