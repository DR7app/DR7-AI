-- 01/10/2026 (direzione): bottone "Foto inviata" sulla prenotazione.
--
-- Le foto e i video del mezzo partono dal telefono dell'operatore (troppo
-- pesanti per il gestionale). Il bottone registra che sono stati mandati
-- (booking_details.foto_pre_consegna_inviata_at) e manda al cliente il
-- messaggio "Check-in Digitale", modificabile da Messaggi di Sistema Pro >
-- Documenti. Evento: rental_foto_inviata.
--
-- L'allarme "Foto pre-consegna mancanti" guarda quel campo: si collega qui,
-- is_enabled NON si tocca (accendere resta una scelta della direzione da
-- Centralina Pro > Allarmi).

INSERT INTO system_messages (message_key, label, description, message_body, is_enabled, is_automatic, include_header, handled_events)
VALUES (
  'pro_checkin_digitale',
  'Check-in Digitale (Foto inviate)',
  'WhatsApp al cliente quando si preme "Foto inviata" sulla prenotazione: foto e video del mezzo gia'' mandati prima della consegna',
  E'Gentile Cliente,\n\nil check-in digitale del veicolo è stato completato con successo.\n\nLe abbiamo inoltrato la documentazione fotografica e video relativa allo stato del veicolo al momento della consegna, inclusi carrozzeria, cerchi, chilometraggio, livello carburante e condizioni generali.\n\nLa documentazione viene registrata nel sistema DR7 a tutela del Cliente e della Società.\n\nDR7 | Digital Vehicle Check-in',
  true,
  false,
  false,
  ARRAY['rental_foto_inviata']
)
ON CONFLICT (message_key) DO UPDATE
  SET message_body   = EXCLUDED.message_body,
      handled_events = EXCLUDED.handled_events
  WHERE coalesce(system_messages.message_body, '') = '';

UPDATE system_alarms SET detector = 'op_pickup_photos_missing', stato_rilevamento = 'attivo'
 WHERE id = 'rit_foto_pre_consegna_mancanti' AND stato_rilevamento = 'in_attesa';

-- ── Messaggio al cliente collegato a un allarme, inviato da solo ─────────
-- Centralina Pro > Allarmi: si sceglie un template Pro (con ricerca) e si
-- accende "Invia automaticamente quando suona". Spento di default: una riga
-- che aveva gia' un messaggio scelto (pensato per il bottone "Avvisa il
-- cliente") non deve cominciare a scrivere ai clienti senza che qualcuno
-- lo decida.
ALTER TABLE public.system_alarms
  ADD COLUMN IF NOT EXISTS messaggio_cliente_auto boolean NOT NULL DEFAULT false;

-- Un messaggio per occorrenza: alarm-send-message prenota la riga passando
-- messaggio_cliente_at da NULL a adesso; l'esito resta scritto.
ALTER TABLE public.alarm_events
  ADD COLUMN IF NOT EXISTS messaggio_cliente_at    timestamptz,
  ADD COLUMN IF NOT EXISTS messaggio_cliente_esito text;
