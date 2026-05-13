-- Migration: DB-driven event routing for system_messages
-- =====================================================================
-- Aggiunge la colonna `handled_events text[]` su system_messages così
-- l'admin può assegnare quali eventi di codice (legacy keys come
-- 'rental_new_customer', 'carwash_new_customer', 'wallet_bonus_credit',
-- ecc.) sono gestiti da ogni template, senza intervento dev.
--
-- Il server resolver (netlify/functions/utils/messageTemplates.ts) ora
-- consulta PRIMA questa colonna. Se nessun template dichiara di gestire
-- una chiave, ricade alla mappa hardcoded OLD_TO_PRO per compat.
--
-- Sicuro da eseguire più volte (idempotente).
-- =====================================================================

ALTER TABLE system_messages
  ADD COLUMN IF NOT EXISTS handled_events text[] NOT NULL DEFAULT '{}'::text[];

-- Index GIN per lookup veloce "trova template che gestisce evento X"
CREATE INDEX IF NOT EXISTS idx_system_messages_handled_events
  ON system_messages USING gin (handled_events);

-- Seed iniziale: copia il routing hardcoded esistente (OLD_TO_PRO)
-- così il comportamento corrente è preservato. Esegue solo quando il
-- template non ha già handled_events non-vuoto (così re-eseguire la
-- migrazione non sovrascrive scelte manuali dell'admin).

UPDATE system_messages SET handled_events = ARRAY['rental_new_customer', 'rental_new', 'rental_new_admin']::text[]
  WHERE message_key = 'pro_conferma_noleggio' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['rental_modified']::text[]
  WHERE message_key = 'pro_promemoria_appuntamento' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['deposit_return_iban']::text[]
  WHERE message_key = 'pro_richiesta_iban' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['carwash_new_customer', 'carwash_new', 'carwash_new_admin']::text[]
  WHERE message_key = 'pro_conferma_lavaggio' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['carwash_modified', 'mechanical_modified']::text[]
  WHERE message_key = 'pro_promemoria_pagamento' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['mechanical_new_customer', 'mechanical_new', 'mechanical_new_admin']::text[]
  WHERE message_key = 'pro_conferma_meccanica' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['signature_request_link', 'document_signature_link']::text[]
  WHERE message_key = 'pro_richiesta_firma' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['signature_reminder_whatsapp']::text[]
  WHERE message_key = 'pro_promemoria_firma' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['signature_otp_whatsapp', 'admin_new_website_quote', 'admin_no_cauzione_request']::text[]
  WHERE message_key = 'pro_richiesta_otp' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['payment_link_customer', 'rental_da_saldare_customer']::text[]
  WHERE message_key = 'pro_richiesta_pagamento' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['booking_cancelled_whatsapp', 'website_booking_cancelled_customer']::text[]
  WHERE message_key = 'pro_custom_prenotazione_annullata_da_sito_1776503923221' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY[
    'payment_received_extension', 'payment_received_extension_admin',
    'payment_received_damages', 'payment_received_damages_admin'
  ]::text[]
  WHERE message_key = 'pro_conferma_pagamento' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['review_request_whatsapp']::text[]
  WHERE message_key = 'pro_marketing_recensione' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['birthday_message']::text[]
  WHERE message_key = 'pro_marketing_compleanno' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['wallet_bonus_credit']::text[]
  WHERE message_key = 'pro_wallet_bonus_cliente' AND coalesce(array_length(handled_events, 1), 0) = 0;

UPDATE system_messages SET handled_events = ARRAY['fidelity_voucher_whatsapp']::text[]
  WHERE message_key = 'pro_fidelity_voucher' AND coalesce(array_length(handled_events, 1), 0) = 0;

-- Verifica: quanti template hanno almeno un evento assegnato?
-- SELECT message_key, label, handled_events FROM system_messages
--   WHERE array_length(handled_events, 1) > 0 ORDER BY message_key;
