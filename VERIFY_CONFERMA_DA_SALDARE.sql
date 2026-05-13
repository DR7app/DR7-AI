-- =====================================================================
-- Verify the renamed Pro template fires for the right events.
-- Run AFTER the RENAME_CONFERMA_PAGAMENTO_KEY.sql migration.
-- Returns a single row showing how the template will behave.
-- =====================================================================

SELECT
  id,
  message_key,
  label,
  is_enabled,
  LENGTH(COALESCE(message_body, ''))                 AS body_length,
  LEFT(COALESCE(message_body, ''), 120)              AS body_preview,
  target_service_type,
  handled_events,
  is_automatic,
  trigger_event,
  updated_at
FROM public.system_messages
WHERE message_key = 'pro_conferma_da_saldare';
