-- ============================================================================
-- Il PDF della fattura parte su WhatsApp UNA VOLTA SOLA
-- ============================================================================
--
-- COSA SUCCEDEVA
-- Il cliente riceveva la stessa fattura due (o piu') volte su WhatsApp, mentre
-- nella tab Fatture ne compariva una sola.
--
-- La riga era gia' protetta: la migrazione 20260901_fatture_doppie ha messo
-- l'indice unico, e `generate-invoice-from-booking` aggiorna la fattura che
-- esiste invece di crearne un'altra. L'INVIO no. Dopo aver aggiornato la riga
-- la function proseguiva fino in fondo e rigenerava il PDF mandandolo su
-- WhatsApp: un messaggio per ogni chiamata.
--
-- E le chiamate sulla stessa prenotazione sono tante:
--   - Sito/pages/PaymentSuccessPage.tsx, quando il cliente torna dal 3D Secure
--   - nexi-payment-callback, che Nexi ripete finche' non riceve un 200
--   - post-booking-webhook, chiamato dal sito a prenotazione creata
--   - il cron di riconciliazione e il "segna pagato" dell'operatore
--
-- L'unico freno esistente era la fattura gia' trasmessa allo SDI, che pero'
-- parte solo con codice fiscale o P.IVA: un privato senza codice fiscale resta
-- 'draft' per sempre, quindi riceveva il PDF ad ogni singola chiamata.
--
-- COSA FA QUESTA MIGRAZIONE
-- Aggiunge la colonna con cui la function si PRENOTA l'invio: la scrive solo
-- se e' ancora NULL, e chi non se la prende salta l'invio. Stessa forma di
-- `avviso_inviato_at` per le ricariche wallet: l'idempotenza sta nella
-- function, non nei chiamanti, che sono troppi per fidarsi.
--
-- Le fatture gia' emesse restano a NULL: la prima chiamata futura mandera' il
-- PDF una volta e poi si chiude da sola. Nessun invio retroattivo.
-- ============================================================================

ALTER TABLE public.fatture
    ADD COLUMN IF NOT EXISTS pdf_whatsapp_inviato_at timestamptz;

COMMENT ON COLUMN public.fatture.pdf_whatsapp_inviato_at IS
    'Momento in cui il PDF della fattura e'' stato mandato al cliente su WhatsApp. Vale da lucchetto: generate-invoice-from-booking lo scrive solo se e'' NULL e manda solo se se l''e'' preso, cosi'' le chiamate ripetute (callback Nexi, pagina di successo, cron) non rimandano la stessa fattura.';
