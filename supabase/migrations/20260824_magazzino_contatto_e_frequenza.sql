-- ============================================================================
-- MAGAZZINO — contatto d'ordine memorizzato e ordini periodici (24/08/2026)
--
-- Problema (direzione): il numero WhatsApp dell'ordine si digitava OGNI volta
-- (`sendPhone`, stato locale della tab), quindi per il caffe' bisognava
-- ricordarsi e riscrivere lo stesso contatto a ogni riordino. E l'unico
-- riordino automatico esistente era quello a soglia: non c'era modo di dire
-- "questo articolo si ordina ogni N giorni".
--
-- Qui si aggiunge, PER ARTICOLO:
--   - contatto_ordine + contatto_tipo  -> email o numero WhatsApp, salvati;
--   - frequenza_giorni                 -> ordine periodico (NULL/0 = spento);
--   - riordino_automatico              -> se l'ordine parte da solo o va
--                                          confermato a mano ("Ordine manuale");
--   - ultimo_riordino_periodico        -> ancora anti-doppione del cron.
-- ============================================================================

ALTER TABLE public.inv_articoli
  ADD COLUMN IF NOT EXISTS contatto_ordine            TEXT,
  ADD COLUMN IF NOT EXISTS contatto_tipo              TEXT,
  ADD COLUMN IF NOT EXISTS frequenza_giorni           INTEGER,
  ADD COLUMN IF NOT EXISTS riordino_automatico        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ultimo_riordino_periodico  DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inv_articoli_contatto_tipo_chk') THEN
    ALTER TABLE public.inv_articoli
      ADD CONSTRAINT inv_articoli_contatto_tipo_chk
      CHECK (contatto_tipo IS NULL OR contatto_tipo IN ('whatsapp', 'email'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inv_articoli_frequenza_chk') THEN
    ALTER TABLE public.inv_articoli
      ADD CONSTRAINT inv_articoli_frequenza_chk
      CHECK (frequenza_giorni IS NULL OR (frequenza_giorni >= 1 AND frequenza_giorni <= 365));
  END IF;
END $$;

COMMENT ON COLUMN public.inv_articoli.contatto_ordine IS
  'Email o numero WhatsApp a cui va l''ordine di questo articolo. Salvato una volta, riusato a ogni riordino.';
COMMENT ON COLUMN public.inv_articoli.contatto_tipo IS
  'whatsapp | email — come interpretare contatto_ordine.';
COMMENT ON COLUMN public.inv_articoli.frequenza_giorni IS
  'Ogni quanti giorni riordinare automaticamente. NULL o 0 = solo al raggiungimento della soglia.';
COMMENT ON COLUMN public.inv_articoli.riordino_automatico IS
  'FALSE = l''ordine viene solo proposto (Ordine manuale), non parte da solo.';

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'inv_articoli'
   AND column_name IN ('contatto_ordine','contatto_tipo','frequenza_giorni','riordino_automatico','ultimo_riordino_periodico')
 ORDER BY column_name;
