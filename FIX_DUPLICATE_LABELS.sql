-- Risolvi i label duplicati in system_messages.
-- Causa: qualcuno ha rinominato la label di pro_* canonical sbagliato,
-- creando duplicati che confondono la UI admin.

-- ─────────────────────────────────────────────────────────────────
-- 1) Diagnosi PRIMA della modifica
-- ─────────────────────────────────────────────────────────────────
SELECT message_key, label, handled_events,
       LEFT(message_body, 120) AS body_start
FROM public.system_messages
WHERE label IN ('Link Firma Contratto', 'Preventivo WhatsApp')
  AND is_enabled = true
ORDER BY label, message_key;

-- ─────────────────────────────────────────────────────────────────
-- 2) FIX: rinomina i canonical mal-rinominati al loro nome corretto.
--    Decommenta dopo aver verificato la diagnosi sopra.
-- ─────────────────────────────────────────────────────────────────

/*
-- pro_conferma_contratto_firmato → torna a "Conferma Contratto Firmato"
-- Era stato rinominato in "Link Firma Contratto" creando duplicato con
-- pro_richiesta_firma. Mantiene i suoi handled_events (booking_paid_*)
-- ma con label coerente con la sua funzione canonica.
UPDATE public.system_messages
SET label = 'Conferma Contratto Firmato',
    description = 'Inviato al cliente dopo che ha firmato il contratto.',
    updated_at = NOW()
WHERE message_key = 'pro_conferma_contratto_firmato'
  AND label = 'Link Firma Contratto';

-- pro_promemoria_checkin → torna a "Promemoria Check-in"
-- Era stato rinominato in "Preventivo WhatsApp" creando duplicato con
-- preventivo_whatsapp (legacy).
UPDATE public.system_messages
SET label = 'Promemoria Check-in',
    description = 'Promemoria inviato al cliente prima del check-in.',
    updated_at = NOW()
WHERE message_key = 'pro_promemoria_checkin'
  AND label = 'Preventivo WhatsApp';

-- Stesso problema su pro_promemoria_checkout (renominato "Preventivo senza sconto")
UPDATE public.system_messages
SET label = 'Promemoria Check-out',
    description = 'Promemoria inviato al cliente prima del check-out.',
    updated_at = NOW()
WHERE message_key = 'pro_promemoria_checkout'
  AND label = 'Preventivo senza sconto';

-- Altri canonical con label mal-rinominate:
-- pro_promemoria_pickup → renominato "Codice OTP Firma"
UPDATE public.system_messages
SET label = 'Promemoria Ritiro',
    description = 'Promemoria inviato al cliente prima del ritiro veicolo.',
    updated_at = NOW()
WHERE message_key = 'pro_promemoria_pickup'
  AND label = 'Codice OTP Firma';

-- pro_richiesta_documenti → renominato "Credito Wallet Bonus (cliente)"
UPDATE public.system_messages
SET label = 'Richiesta Documenti',
    description = 'Richiesta documenti cliente (patente, CI, ecc.).',
    updated_at = NOW()
WHERE message_key = 'pro_richiesta_documenti'
  AND label = 'Credito Wallet Bonus (cliente)';

-- pro_conferma_preventivo → renominato "Richiesta Recensione"
UPDATE public.system_messages
SET label = 'Conferma Preventivo',
    description = 'Conferma invio preventivo al cliente.',
    updated_at = NOW()
WHERE message_key = 'pro_conferma_preventivo'
  AND label = 'Richiesta Recensione';
*/

-- ─────────────────────────────────────────────────────────────────
-- 3) VERIFICA dopo il fix
-- ─────────────────────────────────────────────────────────────────
SELECT
  COUNT(*) AS dup_count,
  STRING_AGG(message_key, ', ') AS keys_with_label
FROM public.system_messages
WHERE is_enabled = true
GROUP BY label
HAVING COUNT(*) > 1
ORDER BY label;
