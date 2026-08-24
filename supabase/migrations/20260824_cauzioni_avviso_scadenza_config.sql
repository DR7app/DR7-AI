-- ============================================================================
-- AVVISO SCADENZA CAUZIONE — DESTINATARI, CANALI E ANTICIPO (24/08/2026)
--
-- Richiesta direzione: l'avviso di scadenza cauzione deve poter partire anche
-- PRIMA della scadenza (fino a 3 giorni), il giorno stesso, o DOPO (fino a 3
-- giorni), e deve andare al numero WhatsApp e all'indirizzo email scelti, a
-- mano oppure da solo.
--
--   avviso_offsets: giorni rispetto alla scadenza.
--       -3 -2 -1 = tre/due/un giorno PRIMA
--        0       = il giorno stesso
--       +1 +2 +3 = uno/due/tre giorni DOPO
--     Si possono scegliere piu' momenti: {-1,0,2} manda tre avvisi.
--
--   avviso_modalita: 'automatico' = lo manda il cron; 'manuale' = parte solo
--     dal pulsante "Invia ora" in Centralina Pro > Cauzioni.
--
--   avviso_whatsapp / avviso_email: elenco destinatari (uno per riga, oppure
--     separati da virgola). Vuoti = si ricade sui numeri staff gia'
--     configurati in Centralina (notifications.cauzioni_staff_phones).
--
-- Finche' questa migration non viene eseguita il gestionale si comporta come
-- prima: avviso il giorno stesso, solo WhatsApp, automatico.
-- ============================================================================

ALTER TABLE public.cauzioni_config
  ADD COLUMN IF NOT EXISTS avviso_modalita TEXT NOT NULL DEFAULT 'automatico',
  ADD COLUMN IF NOT EXISTS avviso_offsets  INTEGER[] NOT NULL DEFAULT ARRAY[0],
  ADD COLUMN IF NOT EXISTS avviso_whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS avviso_email    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cauzioni_config_avviso_modalita_chk') THEN
    ALTER TABLE public.cauzioni_config
      ADD CONSTRAINT cauzioni_config_avviso_modalita_chk
      CHECK (avviso_modalita IN ('automatico','manuale'));
  END IF;
END $$;

COMMENT ON COLUMN public.cauzioni_config.avviso_offsets IS
  'Giorni rispetto alla scadenza: negativi = prima, 0 = giorno stesso, positivi = dopo. Ammessi da -3 a +3.';

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT id, giorni_restituzione_default, avviso_modalita, avviso_offsets,
       COALESCE(avviso_whatsapp, '(staff Centralina)') AS whatsapp,
       COALESCE(avviso_email, '(nessuno)') AS email
  FROM public.cauzioni_config
 WHERE id = 'main';
