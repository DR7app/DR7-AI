-- ============================================================================
-- CATEGORIE DI MAGAZZINO PER BUSINESS (24/08/2026)
--
-- Richiesta direzione: "i ricambi veicoli devono stare nel magazzino Lavaggio
-- & Meccanica, e' logico". Oggi ogni tab di business mostra TUTTE e 17 le
-- categorie: nel Noleggio Mare comparivano pastiglie freno e filtri.
--
-- Una categoria puo' servire piu' business (pulizia, caffetteria, ufficio...),
-- quindi lo scope e' un elenco:
--   business_scope NULL o vuoto -> categoria trasversale, si vede ovunque
--   business_scope = {'car_wash'} -> solo nel magazzino Lavaggio & Meccanica
--
-- Il Magazzino Generale continua a mostrare tutto, sempre.
-- ============================================================================

ALTER TABLE public.inv_categorie
  ADD COLUMN IF NOT EXISTS business_scope TEXT[];

COMMENT ON COLUMN public.inv_categorie.business_scope IS
  'Business in cui la categoria e'' visibile. NULL/vuoto = tutti. Vedi src/utils/businessScope.ts';

-- Ricambi, freni, filtri, lubrificanti, vernici e prodotti lavaggio: sono il
-- materiale con cui lavora l''officina, non il magazzino di barche o elicotteri.
UPDATE public.inv_categorie
   SET business_scope = ARRAY['car_wash']
 WHERE codice IN ('RIC','FRE','FIL','LUB','VER','LAV','BOM');

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT codice, nome, COALESCE(business_scope::text, 'tutti') AS visibile_in
  FROM public.inv_categorie
 ORDER BY ordine;
