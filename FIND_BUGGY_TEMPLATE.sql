-- Trova il template responsabile del messaggio buggy (placeholder non sostituiti).
-- Il corpo dal screenshot contiene "prenotazione è stata confermata" + lista
-- "PRENOTAZIONE NOLEGGIO ID: DR7-{booking_id} ..."
SELECT
  id,
  message_key,
  label,
  is_enabled,
  include_header,
  trigger_event,
  trigger_offset_hours,
  target_status,
  target_service_type,
  is_automatic,
  LEFT(message_body, 600) AS body_preview
FROM public.system_messages
WHERE message_body ILIKE '%prenotazione è stata confermata%'
   OR (message_body ILIKE '%{booking_id}%' AND message_body ILIKE '%{vehicle_name}%' AND message_body ILIKE '%Grazie%DR7%')
ORDER BY label;

-- Bonus: tutti i template che usano {payment_method} (probabile fonte del bug
-- perché {payment_method} NON è nella vars list di send-whatsapp-notification)
SELECT
  message_key,
  label,
  trigger_event,
  is_enabled,
  LEFT(message_body, 400) AS body_preview
FROM public.system_messages
WHERE message_body ILIKE '%{payment_method}%'
ORDER BY label;

-- E il send_log delle ultime 24h per la prenotazione di Matteo Spada con
-- tutti i campi (anche message_key referenced dal template)
SELECT
  l.sent_at,
  l.status,
  l.error,
  m.message_key,
  m.label,
  m.trigger_event
FROM public.system_message_send_log l
LEFT JOIN public.system_messages m ON m.id = l.system_message_id
WHERE l.booking_id IN (
  SELECT id FROM public.bookings
  WHERE LOWER(customer_name) LIKE '%matteo%spada%'
  ORDER BY created_at DESC
  LIMIT 5
)
ORDER BY l.sent_at DESC
LIMIT 30;
