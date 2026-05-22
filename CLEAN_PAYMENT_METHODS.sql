-- Mantieni SOLO i 5 metodi di pagamento operativi:
--   - contanti           → Contanti
--   - bonifico           → Bonifico bancario
--   - credit_wallet      → Credit Wallet
--   - nexi_pay_by_link   → Nexi - Pay by Link
--   - carta_punti        → Carta Punti

UPDATE public.centralina_pro_config
SET config = jsonb_set(
  config,
  '{fiscal,payment_methods}',
  COALESCE(
    (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(config->'fiscal'->'payment_methods') elem
      WHERE elem->>'key' IN ('contanti', 'bonifico', 'credit_wallet', 'nexi_pay_by_link', 'carta_punti')
    ),
    '[]'::jsonb
  )
)
WHERE id = 'main';

-- Verifica
SELECT
  jsonb_array_length(config->'fiscal'->'payment_methods') AS totale,
  config->'fiscal'->'payment_methods' AS metodi
FROM public.centralina_pro_config
WHERE id = 'main';
