-- ============================================================================
-- CONTRATTO OPERATORE: PAGA GIORNALIERA (21/10/2026)
--
-- stipendio_frequenza accetta anche 'giornaliera': l'importo in
-- stipendio_mensile_eur (nome storico) e' la tariffa di una giornata.
-- Giornata timbrata (entrata e uscita) = giornata pagata intera.
-- Calcolo in src/utils/pagaGiornaliera.ts.
-- ============================================================================

ALTER TABLE public.operatore_contratto
  DROP CONSTRAINT IF EXISTS operatore_contratto_stipendio_frequenza_chk;

ALTER TABLE public.operatore_contratto
  ADD CONSTRAINT operatore_contratto_stipendio_frequenza_chk
  CHECK (stipendio_frequenza IN ('settimanale', 'mensile', 'giornaliera'));
