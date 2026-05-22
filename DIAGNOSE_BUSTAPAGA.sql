-- Diagnostica Busta Paga: cosa manca per il calcolo

-- 1) Operatori attivi (deve essere ≥ 1)
SELECT id, nome, cognome, email, ruolo, attivo, ore_a_recuperare_min
FROM public.operatori_persone
WHERE attivo = true
ORDER BY cognome;

-- 2) Contratti attivi — operatori senza riga qui = "No contratto" nella tabella
SELECT op.nome, op.cognome,
       oc.paga_oraria_eur, oc.paga_straordinario_eur,
       oc.stipendio_mensile_eur, oc.stipendio_frequenza,
       oc.straordinario_abilitato, oc.ore_soglia_straordinario,
       oc.attivo AS contratto_attivo
FROM public.operatori_persone op
LEFT JOIN public.operatore_contratto oc
       ON oc.operatore_id = op.id AND oc.attivo = true
WHERE op.attivo = true
ORDER BY op.cognome;

-- 3) Timesheet entries del periodo (oggi - 29 giorni → oggi)
SELECT op.cognome, op.nome,
       COUNT(*) FILTER (WHERE te.tipo = 'entrata') AS entrate,
       COUNT(*) FILTER (WHERE te.tipo = 'uscita')  AS uscite,
       MIN(te.data) AS prima_data, MAX(te.data) AS ultima_data
FROM public.operatori_persone op
LEFT JOIN public.timesheet_entries te
       ON te.operatore_id = op.id
      AND te.data >= (CURRENT_DATE - INTERVAL '29 days')::date
      AND te.data <= CURRENT_DATE
WHERE op.attivo = true
GROUP BY op.id, op.cognome, op.nome
ORDER BY op.cognome;

-- 4) Salvatore: cosa contribuisce al suo Saldo -€xxx
SELECT op.nome, op.cognome,
       op.ore_a_recuperare_min,
       (op.ore_a_recuperare_min / 60.0)         AS ore_recupero,
       oc.paga_oraria_eur,
       -((op.ore_a_recuperare_min / 60.0) * COALESCE(oc.paga_oraria_eur,0)) AS correzione_eur
FROM public.operatori_persone op
LEFT JOIN public.operatore_contratto oc
       ON oc.operatore_id = op.id AND oc.attivo = true
WHERE LOWER(op.nome) LIKE 'salvatore%' OR LOWER(op.cognome) LIKE 'salvatore%';

-- ─────────────────────────────────────────────────────────────────
-- FIX rapidi (decommenta solo dopo aver letto le query sopra)
-- ─────────────────────────────────────────────────────────────────

-- A) Azzera le ore a recuperare di Salvatore (se -€700 e' un errore di data entry)
/*
UPDATE public.operatori_persone
SET ore_a_recuperare_min = 0
WHERE LOWER(nome) LIKE 'salvatore%';
*/

-- B) Crea/attiva un contratto per un operatore senza contratto
/*
INSERT INTO public.operatore_contratto
  (operatore_id, paga_oraria_eur, paga_straordinario_eur, straordinario_abilitato, ore_soglia_straordinario, attivo)
VALUES
  ('<OPERATORE_ID>', 7.00, 10.00, true, 8, true);
*/
