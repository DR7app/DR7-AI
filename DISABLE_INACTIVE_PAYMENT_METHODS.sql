-- Disabilita TUTTI tranne i 5 attivi.
-- Versione sicura: COALESCE per evitare NULL e violazione NOT NULL.

UPDATE public.centralina_pro_config
SET config = jsonb_set(
  config,
  '{fiscal,payment_methods}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' IN ('contanti','bonifico','credit_wallet','nexi_pay_by_link','carta_punti')
            THEN jsonb_set(elem, '{is_enabled}', 'true'::jsonb, true)
          ELSE jsonb_set(elem, '{is_enabled}', 'false'::jsonb, true)
        END
      )
      FROM jsonb_array_elements(COALESCE(config->'fiscal'->'payment_methods', '[]'::jsonb)) elem
    ),
    '[]'::jsonb
  )
)
WHERE id = 'main';

-- Verifica: 5 attivi, gli altri disabilitati
SELECT
  elem->>'key' AS key,
  elem->>'label' AS label,
  elem->>'is_enabled' AS enabled
FROM public.centralina_pro_config,
     jsonb_array_elements(config->'fiscal'->'payment_methods') elem
WHERE id = 'main'
ORDER BY (elem->>'is_enabled')::boolean DESC, elem->>'key';
