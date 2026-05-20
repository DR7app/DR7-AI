-- Lista COMPLETA di tutti i template in Messaggi di Sistema Pro.
-- Output usato per rigenerare l'audit "quando parte ogni messaggio".
-- Include i custom (pro_custom_*) creati dall'admin via UI.

SELECT
  message_key,
  label,
  description,
  is_enabled,
  is_automatic,
  include_header,
  trigger_event,
  trigger_offset_hours,
  send_hour,
  target_service_type,
  target_status,
  target_payment_method,
  target_with_deposit,
  target_residency,
  target_membership_tier,
  handled_events,                              -- array di legacy event keys che questo template gestisce
  LEFT(message_body, 250) AS body_preview
FROM public.system_messages
WHERE message_key IS NOT NULL
  AND message_key NOT LIKE 'message_wrapper_%'  -- escludi i wrapper header/footer
ORDER BY
  CASE WHEN is_enabled THEN 0 ELSE 1 END,      -- attivi prima
  message_key;
