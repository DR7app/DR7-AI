-- ============================================================================
-- CONTRATTO OPERATORE: PAGA GIORNALIERA (21/10/2026)
--
-- paga_giornaliera_eur = tariffa di UNA giornata, casella propria nel
-- contratto. Se impostata: paga del periodo = giornate timbrate (entrata e
-- uscita) nel periodo x tariffa. Calcolo in src/utils/pagaGiornaliera.ts.
-- Il CHECK su stipendio_frequenza accetta anche 'giornaliera' (prima versione,
-- resta valida per i contratti salvati cosi').
-- ============================================================================

ALTER TABLE public.operatore_contratto
  ADD COLUMN IF NOT EXISTS paga_giornaliera_eur NUMERIC(10,2);

ALTER TABLE public.operatore_contratto
  DROP CONSTRAINT IF EXISTS operatore_contratto_stipendio_frequenza_chk;

ALTER TABLE public.operatore_contratto
  ADD CONSTRAINT operatore_contratto_stipendio_frequenza_chk
  CHECK (stipendio_frequenza IN ('settimanale', 'mensile', 'giornaliera'));
