-- FIX: "Link pagamento lavaggi" deve gestire SOLO l'evento payment_link_customer.
-- handled_events e' un text[], non jsonb.

-- 1) Stato attuale
SELECT message_key, label, handled_events
FROM public.system_messages
WHERE message_key LIKE 'pro_custom_link_pagamento_lavaggi%';

-- 2) FIX
UPDATE public.system_messages
SET handled_events = ARRAY['payment_link_customer']::text[]
WHERE message_key LIKE 'pro_custom_link_pagamento_lavaggi%';

-- 3) Verifica
SELECT message_key, label, handled_events
FROM public.system_messages
WHERE message_key LIKE 'pro_custom_link_pagamento_lavaggi%';

-- 4) Stato "Conferma Lavaggio" - deve gestire i carwash_* events
SELECT message_key, label, handled_events
FROM public.system_messages
WHERE message_key = 'pro_conferma_lavaggio';

-- Se "Conferma Lavaggio" ha handled_events vuoti o senza i carwash, decommenta:
/*
UPDATE public.system_messages
SET handled_events = ARRAY[
  'carwash_new_customer',
  'carwash_new',
  'carwash_new_admin',
  'carwash_modified'
]::text[]
WHERE message_key = 'pro_conferma_lavaggio';
*/

-- 5) Stato "Conferma Meccanica" (stesso pattern)
SELECT message_key, label, handled_events
FROM public.system_messages
WHERE message_key = 'pro_conferma_meccanica';

/*
UPDATE public.system_messages
SET handled_events = ARRAY[
  'mechanical_new_customer',
  'mechanical_new',
  'mechanical_new_admin',
  'mechanical_modified'
]::text[]
WHERE message_key = 'pro_conferma_meccanica';
*/
