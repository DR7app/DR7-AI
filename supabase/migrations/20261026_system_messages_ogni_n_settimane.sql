-- ============================================================================
-- MESSAGGI RICORRENTI OGNI N SETTIMANE (26/10/2026)
--
-- Il messaggio WhatsApp della spazzatura (ricorrenza on_schedule) partiva
-- ogni settimana nei giorni scelti, anche quando il ritiro e' ogni 2
-- settimane. recurrence_every_weeks = ogni quante settimane parte (1 = ogni
-- settimana, il comportamento di prima); le settimane si contano da quella
-- che contiene recurrence_start_date.
-- Calcolo in netlify/functions/process-scheduled-system-messages-cron.ts.
-- ============================================================================

ALTER TABLE public.system_messages
  ADD COLUMN IF NOT EXISTS recurrence_every_weeks smallint NOT NULL DEFAULT 1;

ALTER TABLE public.system_messages
  DROP CONSTRAINT IF EXISTS system_messages_recurrence_every_weeks_check;

ALTER TABLE public.system_messages
  ADD CONSTRAINT system_messages_recurrence_every_weeks_check
  CHECK (recurrence_every_weeks BETWEEN 1 AND 8);
