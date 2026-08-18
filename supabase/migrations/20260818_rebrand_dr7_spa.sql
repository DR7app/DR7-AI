-- Rebrand: "Dubai Rent 7.0 S.p.A." -> "DR7 S.p.A." nei testi SALVATI IN DATABASE.
--
-- Il codice e' gia' stato ripulito (email OTP, lettera multe, default del Sito),
-- ma i messaggi che partono davvero ai clienti vivono in `system_messages` e i
-- testi del sito in `centralina_pro_config`: quelli si cambiano solo qui.
--
-- REGOLA DELLA CASA: prima si GUARDA, poi si scrive. Esegui il blocco 1, leggi
-- cosa verrebbe toccato, e solo dopo lancia il blocco 2.

-- ── 1) COSA VERREBBE TOCCATO (nessuna scrittura) ────────────────────────────
SELECT 'system_messages' AS tabella, message_key AS chiave,
       substring(message_body from '.{0,60}Dubai Rent.{0,60}') AS estratto
  FROM public.system_messages
 WHERE message_body ILIKE '%Dubai Rent%'
UNION ALL
SELECT 'centralina_pro_config', id,
       substring(config::text from '.{0,60}Dubai Rent.{0,60}')
  FROM public.centralina_pro_config
 WHERE config::text ILIKE '%Dubai Rent%';

-- ── 2) SOSTITUZIONE (lanciare dopo aver letto il blocco 1) ──────────────────
-- Copre le varianti realmente presenti nei seed: "Dubai Rent 7.0 S.p.A.",
-- "DUBAI RENT 7.0 SPA", "Dubai Rent 7.0 SpA". La P.IVA NON si tocca: l'azienda
-- cambia nome, non partita IVA.
UPDATE public.system_messages
   SET message_body = regexp_replace(
         message_body,
         'Dubai\s*Rent\s*7\.0\s*S\.?\s*p\.?\s*A\.?',
         'DR7 S.p.A.',
         'gi'
       ),
       updated_at = NOW()
 WHERE message_body ILIKE '%Dubai Rent%';

UPDATE public.centralina_pro_config
   SET config = regexp_replace(
         config::text,
         'Dubai\s*Rent\s*7\.0\s*S\.?\s*p\.?\s*A\.?',
         'DR7 S.p.A.',
         'gi'
       )::jsonb
 WHERE config::text ILIKE '%Dubai Rent%';

-- ── 3) VERIFICA: deve tornare ZERO righe ────────────────────────────────────
SELECT 'system_messages' AS tabella, count(*) AS rimaste
  FROM public.system_messages WHERE message_body ILIKE '%Dubai Rent%'
UNION ALL
SELECT 'centralina_pro_config', count(*)
  FROM public.centralina_pro_config WHERE config::text ILIKE '%Dubai Rent%';
