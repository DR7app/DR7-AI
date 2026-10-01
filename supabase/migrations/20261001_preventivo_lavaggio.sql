-- 01/10/2026 (direzione): il preventivo Lavaggio mandato su WhatsApp
-- (PreventiviLavaggioView) usava pro_conferma_preventivo, che in Messaggi di
-- Sistema Pro e' stato riusato come "Richiesta Recensione" (gestisce
-- review_request_whatsapp): il cliente riceveva la richiesta di recensione
-- al posto del preventivo. Quella riga NON si tocca (le recensioni passano da
-- li'): il preventivo lavaggio ha il suo template.
INSERT INTO system_messages (message_key, label, description, message_body, is_enabled, is_automatic, include_header, handled_events, target_service_type)
VALUES (
  'pro_preventivo_lavaggio',
  'Preventivo Lavaggio',
  'WhatsApp al cliente dal tab Preventivi Lavaggio (bottone WhatsApp). Token: {nome}, {servizio}, {data}, {ora}, {durata}, {totale}, {veicolo}, {targa}, {note}',
  E'Gentile *{nome}*,\n\ndi seguito il preventivo per il servizio *{servizio}*:\n\n*Data:* {data} ore {ora}\n*Totale:* €{totale}\n\nPer confermare l''appuntamento può rispondere a questo messaggio.\n\nCordiali Saluti,\n*DR7*',
  true, false, false, '{}'::text[], 'all'
)
ON CONFLICT (message_key) DO NOTHING;

-- Richiesta IBAN: {nome cliente} (con lo spazio) non lo riempie nessuno.
UPDATE system_messages SET message_body = replace(message_body, '{nome cliente}', '{nome}')
 WHERE message_key = 'pro_richiesta_iban' AND message_body LIKE '%{nome cliente}%';

-- "Pagato Contanti": testo di prova ("{nome} {nome} test") automatico a ogni
-- nuova prenotazione noleggio. Spento, non cancellato.
UPDATE system_messages SET is_enabled = false
 WHERE message_key LIKE 'pro_custom_pagato_contanti_%' AND trim(message_body) = '{nome} {nome} test';

-- "Codice OTP Firma" (pro_promemoria_pickup): stesso testo e stesso evento di
-- "OTP Firma Contratto" (pro_firma_otp, quello letto da signature-send-otp).
UPDATE system_messages SET is_enabled = false
 WHERE message_key = 'pro_promemoria_pickup' AND label = 'Codice OTP Firma'
   AND EXISTS (SELECT 1 FROM system_messages WHERE message_key = 'pro_firma_otp' AND is_enabled IS NOT FALSE AND coalesce(message_body,'') <> '');
