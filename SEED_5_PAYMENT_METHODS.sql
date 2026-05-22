-- Seed dei 5 metodi di pagamento attivi in centralina_pro_config.
-- L'array fiscal.payment_methods era vuoto → il frontend cadeva su
-- DEFAULT_METHODS hardcoded (29 voci) e il dropdown mostrava tutto.

UPDATE public.centralina_pro_config
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{fiscal,payment_methods}',
  '[
    {"key":"contanti",         "label":"Contanti",            "auto_invoice":true, "is_enabled":true},
    {"key":"bonifico",         "label":"Bonifico bancario",   "auto_invoice":true, "is_enabled":true},
    {"key":"credit_wallet",    "label":"Credit Wallet",       "auto_invoice":false,"is_enabled":true},
    {"key":"nexi_pay_by_link", "label":"Nexi - Pay by Link",  "auto_invoice":true, "is_enabled":true},
    {"key":"carta_punti",      "label":"Carta Punti",         "auto_invoice":false,"is_enabled":true}
  ]'::jsonb,
  true
)
WHERE id = 'main';

-- Verifica: deve mostrare 5 righe
SELECT
  elem->>'key' AS key,
  elem->>'label' AS label,
  elem->>'is_enabled' AS enabled,
  elem->>'auto_invoice' AS auto_invoice
FROM public.centralina_pro_config,
     jsonb_array_elements(config->'fiscal'->'payment_methods') elem
WHERE id = 'main'
ORDER BY elem->>'key';
