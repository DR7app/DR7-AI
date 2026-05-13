-- =====================================================================
-- Rename the Pro slot key from `pro_conferma_pagamento` to
-- `pro_conferma_da_saldare` so the key reflects what the template
-- actually serves (admin-confirmed booking still owed by the customer).
--
-- The code in src/utils/proTemplateRouting.ts now routes EVERY legacy
-- event that previously pointed at `pro_conferma_pagamento` to the new
-- key, so after this UPDATE nothing else needs to change.
--
-- Idempotent — re-running has no effect once the row is already renamed.
-- =====================================================================

UPDATE public.system_messages
SET message_key = 'pro_conferma_da_saldare',
    updated_at  = NOW()
WHERE message_key = 'pro_conferma_pagamento';
