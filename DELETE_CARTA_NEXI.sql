-- Rimuovi "Carta di credito (Nexi)" da centralina_pro_config.config.fiscal.payment_methods
-- Operatori e clienti che lo selezionavano credevano partisse un link → bug.
-- Resta solo "Nexi - Pay by Link" come opzione Nexi (quella che genera il link).

-- 1) Stato attuale (debug)
SELECT jsonb_array_length(config->'fiscal'->'payment_methods') AS prima
FROM public.centralina_pro_config
WHERE id = 'main';

-- 2) Filtra fuori l'entry con key='carta'
UPDATE public.centralina_pro_config
SET config = jsonb_set(
  config,
  '{fiscal,payment_methods}',
  COALESCE(
    (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(config->'fiscal'->'payment_methods') elem
      WHERE elem->>'key' <> 'carta'
    ),
    '[]'::jsonb
  )
)
WHERE id = 'main';

-- 3) Verifica
SELECT jsonb_array_length(config->'fiscal'->'payment_methods') AS dopo,
       jsonb_path_query_array(config->'fiscal'->'payment_methods', '$[*] ? (@.key like_regex "(?i)nexi|carta")') AS nexi_related
FROM public.centralina_pro_config
WHERE id = 'main';
