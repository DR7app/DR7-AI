-- Hotfix 2026-05-13 — il template "Link Pagamento" era stato salvato con
-- message_key=pro_promemoria_dropoff (la chiave del promemoria dropoff
-- noleggio) anziché pro_richiesta_pagamento (la chiave canonica del
-- payment link). Conseguenze:
--   1. Il flusso carwash "Da saldare" (templateKey 'pro_richiesta_pagamento')
--      non trovava il template diretto e si appoggiava al label-fallback
--      'link pagamento'. Risultato: il link non arrivava al cliente.
--   2. La slot canonica del promemoria dropoff è stata sovrascritta con
--      il corpo del payment link — il prossimo invio del promemoria
--      avrebbe mandato il messaggio sbagliato.
--
-- Rimette la chiave a posto. Idempotente: se la riga è già stata
-- rinominata o se esiste già una riga con la chiave target, non fa nulla.

DO $$
BEGIN
  -- Solo se la riga "Link Pagamento" è ancora sotto pro_promemoria_dropoff
  IF EXISTS (
    SELECT 1 FROM public.system_messages
    WHERE message_key = 'pro_promemoria_dropoff'
      AND lower(coalesce(label, '')) LIKE '%link pagamento%'
  )
  -- E nessuna altra riga occupa già pro_richiesta_pagamento
  AND NOT EXISTS (
    SELECT 1 FROM public.system_messages
    WHERE message_key = 'pro_richiesta_pagamento'
  )
  THEN
    UPDATE public.system_messages
       SET message_key = 'pro_richiesta_pagamento',
           updated_at = now()
     WHERE message_key = 'pro_promemoria_dropoff'
       AND lower(coalesce(label, '')) LIKE '%link pagamento%';
    RAISE NOTICE 'Rinominato Link Pagamento da pro_promemoria_dropoff a pro_richiesta_pagamento';
  ELSE
    RAISE NOTICE 'Nessuna azione: riga già rinominata o conflitto con riga esistente';
  END IF;
END $$;
