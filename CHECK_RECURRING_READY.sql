-- Who has a wallet_recurring configured + is the prerequisite card token in place?
-- Run AFTER you save the recurring schedule. If `card_tokenized` is false for a
-- row, the cron will skip that customer when its day comes.

SELECT
  (nome || ' ' || COALESCE(cognome, ''))                AS cliente,
  (metadata -> 'wallet_recurring' ->> 'day')::int       AS day,
  (metadata -> 'wallet_recurring' ->> 'amount')::numeric AS amount_eur,
  (metadata -> 'wallet_recurring' ->> 'active')::boolean AS active,
   metadata -> 'wallet_recurring' ->> 'last_run_at'     AS last_run_at,
  (metadata ->> 'nexi_contract_id' IS NOT NULL)         AS card_tokenized,
  telefono
FROM public.customers_extended
WHERE metadata -> 'wallet_recurring' IS NOT NULL
ORDER BY day;
