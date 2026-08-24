-- ============================================================================
-- MAGAZZINO PER BUSINESS (24/08/2026)
--
-- Richiesta direzione: "ogni categoria deve essere ben differenziata e non
-- prendere dalle altre: il magazzino del Noleggio Mare non e' quello di
-- Terra". Il modulo Inventario resta UNO (stesse categorie, stesse soglie,
-- stesso riordino automatico) ma ogni articolo appartiene a un business.
--
--   business = NULL          -> Magazzino Generale (azienda)
--   business = 'rental'      -> Noleggio Terra
--   business = 'boat_rental' -> Noleggio Mare
--   business = 'heli_rental' -> Noleggio Aria
--   business = 'stay_rental' -> Soggiorni & Ospitalita
--   business = 'car_wash'    -> Lavaggio & Meccanica
--
-- Gli articoli gia' presenti restano com'erano: NULL = Magazzino Generale,
-- cioe' esattamente dove si vedono oggi. Nessuno sparisce.
-- ============================================================================

ALTER TABLE public.inv_articoli
  ADD COLUMN IF NOT EXISTS business TEXT
    CHECK (business IN ('rental','boat_rental','heli_rental','stay_rental','car_wash'));

COMMENT ON COLUMN public.inv_articoli.business IS
  'Business proprietario dell''articolo. NULL = Magazzino Generale (azienda). Vedi src/utils/businessScope.ts';

CREATE INDEX IF NOT EXISTS idx_inv_articoli_business
  ON public.inv_articoli(business, categoria_codice);

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT COALESCE(business, 'GENERALE') AS magazzino, COUNT(*) AS articoli
  FROM public.inv_articoli
 GROUP BY 1
 ORDER BY 1;
