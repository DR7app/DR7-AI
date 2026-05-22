-- Riattiva i 3 Pro template disabilitati. Una volta attivi in DB,
-- la direzione li gestisce da Messaggi di Sistema Pro (toggle ON/OFF).

UPDATE public.system_messages
SET is_enabled = true
WHERE message_key IN (
  'referral_otp_whatsapp',
  'pro_custom_pagato_contanti_1778684866954',
  'membership_renewal_reminder'
);

-- Verifica
SELECT message_key, label, is_enabled
FROM public.system_messages
WHERE message_key IN (
  'referral_otp_whatsapp',
  'pro_custom_pagato_contanti_1778684866954',
  'membership_renewal_reminder'
);
