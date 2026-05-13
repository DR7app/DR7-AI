-- =====================================================================
-- Inspect Pro template(s) by label fragment.
-- Tells you when (which event) the template will fire.
-- Replace 'pagato contanti' with any label keyword you want to search.
-- =====================================================================

SELECT
  id,
  message_key,
  label,
  is_enabled,
  LENGTH(COALESCE(message_body, ''))     AS body_length,
  LEFT(COALESCE(message_body, ''), 200)  AS body_preview,
  target_service_type,
  handled_events,
  is_automatic,
  trigger_event,
  trigger_offset_hours,
  send_hour,
  updated_at
FROM public.system_messages
WHERE LOWER(label) LIKE '%pagato%contanti%'
   OR LOWER(label) LIKE '%contanti%pagato%'
   OR LOWER(label) LIKE '%pagato contanti%'
ORDER BY updated_at DESC;
