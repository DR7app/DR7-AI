-- ============================================================================
-- PREVENTIVI (Mare/Aria/Soggiorni/Lavaggio) — traccia dell'invio WhatsApp
-- 15/09/2026
--
-- Richiesta direzione: "invio whatsapp e converti in appuntamento, stessa cosa
-- del preventivo Noleggio Terra".
--
-- Su Terra (`preventivi`) l'invio passa da Green API e lascia una traccia:
-- status 'inviato' + `whatsapp_sent_at`. `noleggio_preventivi` aveva solo lo
-- stato, quindi non si poteva sapere QUANDO era partito il preventivo — e il
-- pulsante WhatsApp apriva soltanto wa.me, cioe' la chat, senza scrivere nulla.
--
-- Una colonna sola. Chi non l'ha ancora eseguita continua a inviare: il
-- gestionale scrive lo stato e salta la data (nessuna schermata si rompe).
-- ============================================================================

ALTER TABLE public.noleggio_preventivi
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.noleggio_preventivi.whatsapp_sent_at IS
  'Quando il preventivo e'' stato inviato al cliente via WhatsApp (Green API, template Pro "Conferma Preventivo Inviato"). Stesso significato di preventivi.whatsapp_sent_at sul Noleggio Terra.';

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'noleggio_preventivi'
   AND column_name = 'whatsapp_sent_at';
