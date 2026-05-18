-- ─── Nicola Vladimiro Zucca — wallet state + recharge history ───
-- Run this anytime to verify whether the auto-recharge fired and the
-- credit landed correctly.

WITH nicola AS (
  SELECT id AS customer_id, user_id, full_name, metadata
  FROM public.customers_extended
  WHERE LOWER(full_name) LIKE '%nicola%vladimiro%'
     OR (LOWER(nome) LIKE '%nicola%' AND LOWER(cognome) LIKE '%vladimiro%')
  LIMIT 1
)
SELECT
  '1. SETTINGS' AS section,
  n.full_name,
  (n.metadata -> 'wallet_recurring' ->> 'day')::int          AS recurring_day,
  (n.metadata -> 'wallet_recurring' ->> 'amount')::numeric   AS recurring_amount,
  (n.metadata -> 'wallet_recurring' ->> 'active')::boolean   AS active,
   n.metadata -> 'wallet_recurring' ->> 'last_run_at'        AS last_run_at,
  (n.metadata ->> 'nexi_contract_id' IS NOT NULL)            AS card_tokenized
FROM nicola n;

-- Current wallet balance
SELECT
  '2. BALANCE' AS section,
  b.user_id, b.balance, b.last_updated
FROM public.user_credit_balance b
WHERE b.user_id = (SELECT user_id FROM public.customers_extended
                   WHERE LOWER(full_name) LIKE '%nicola%vladimiro%' LIMIT 1);

-- Last 10 wallet transactions (look for reference_type='wallet_auto_recharge')
SELECT
  '3. TRANSACTIONS' AS section,
  t.created_at, t.transaction_type, t.amount, t.balance_after,
  t.reference_type, t.reference_id, t.description
FROM public.credit_transactions t
WHERE t.user_id = (SELECT user_id FROM public.customers_extended
                   WHERE LOWER(full_name) LIKE '%nicola%vladimiro%' LIMIT 1)
ORDER BY t.created_at DESC
LIMIT 10;
