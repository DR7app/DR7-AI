-- Aggiunge la frequenza di pagamento dello stipendio + soglia ore
-- straordinario personalizzabile per operatore.
--
-- - stipendio_frequenza: la colonna stipendio_mensile_eur ora rappresenta
--   l'importo (mensile O settimanale) in base a stipendio_frequenza
-- - ore_soglia_straordinario: ore al giorno oltre le quali il tempo
--   lavorato conta come straordinario (es. 7h per chi non fa 8h piene).
--   Se NULL e straordinario_abilitato=true, default = ore_target_giornaliere.

ALTER TABLE public.operatore_contratto
  ADD COLUMN IF NOT EXISTS stipendio_frequenza TEXT NOT NULL DEFAULT 'mensile',
  ADD COLUMN IF NOT EXISTS ore_soglia_straordinario NUMERIC(4,1) NULL;

ALTER TABLE public.operatore_contratto
  DROP CONSTRAINT IF EXISTS operatore_contratto_stipendio_frequenza_chk;
ALTER TABLE public.operatore_contratto
  ADD CONSTRAINT operatore_contratto_stipendio_frequenza_chk
  CHECK (stipendio_frequenza IN ('settimanale', 'mensile'));

COMMENT ON COLUMN public.operatore_contratto.stipendio_frequenza IS
  'Frequenza pagamento stipendio: mensile (default) o settimanale. L''importo e'' in stipendio_mensile_eur.';
COMMENT ON COLUMN public.operatore_contratto.ore_soglia_straordinario IS
  'Ore di lavoro giornaliere oltre le quali il tempo conta come straordinario. Se NULL, usa ore_target_giornaliere.';
