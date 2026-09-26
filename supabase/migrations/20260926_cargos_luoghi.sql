-- ============================================================================
-- CARGOS: TABELLA UFFICIALE COMUNI E STATI (26/09/2026)
--
-- CARGOS vuole un CODICE per luogo di nascita, cittadinanza, residenza e
-- luoghi di rilascio dei documenti. Fino a oggi il gestionale conosceva ~25
-- comuni scritti a mano nel codice: Sanluri, Quartucciu, Assemini... davano
-- "codice ISTAT mancante" anche con l'indirizzo scritto giusto, e il codice di
-- Oristano era quello soppresso nel 1974.
--
-- Qui c'e' la tabella UFFICIALE di CARGOS (Tabella 1, V_COMUNI_STATI):
-- 11.419 luoghi, comuni soppressi compresi con le loro date di validita' (chi
-- e' nato a Oristano prima del 16/07/1974 ha un codice diverso da chi e' nato
-- dopo). Si ricarica dalla stessa API CARGOS: nessun codice inventato.
--
-- cargos_luoghi_nomi: tutti i modi di scrivere un luogo (nome intero, ogni
-- parte dei nomi bilingui "BOLZANO/BOZEN", alias come "ITALY"), gia'
-- normalizzati con la stessa regola di utils/luoghiCargos.ts (normalizzaLuogo).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cargos_luoghi (
  codice       TEXT PRIMARY KEY,           -- 9 cifre CARGOS (4+regione+ISTAT per i comuni)
  nome         TEXT NOT NULL,              -- come lo scrive CARGOS
  provincia    TEXT,                       -- sigla; 'ES' = stato estero
  valido_dal   DATE,
  valido_al    DATE,                       -- NULL = valido oggi
  aggiornato_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cargos_luoghi_nomi (
  nome_norm    TEXT NOT NULL,
  codice       TEXT NOT NULL REFERENCES public.cargos_luoghi(codice) ON DELETE CASCADE,
  PRIMARY KEY (nome_norm, codice)
);

CREATE INDEX IF NOT EXISTS idx_cargos_luoghi_nomi_codice ON public.cargos_luoghi_nomi(codice);

-- Dati di riferimento pubblici (nomi di comuni e stati): leggibili da tutti,
-- scrivibili solo dal server (service role).
ALTER TABLE public.cargos_luoghi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargos_luoghi_nomi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cargos_luoghi_lettura ON public.cargos_luoghi;
CREATE POLICY cargos_luoghi_lettura ON public.cargos_luoghi FOR SELECT USING (true);
DROP POLICY IF EXISTS cargos_luoghi_nomi_lettura ON public.cargos_luoghi_nomi;
CREATE POLICY cargos_luoghi_nomi_lettura ON public.cargos_luoghi_nomi FOR SELECT USING (true);

GRANT SELECT ON public.cargos_luoghi, public.cargos_luoghi_nomi TO anon, authenticated;

-- I dati si caricano con netlify/functions/cargos-luoghi-sync.ts (API CARGOS,
-- Tabella 1): mai a mano.
