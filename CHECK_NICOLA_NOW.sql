-- Nicola's wallet right now + last 5 transactions.

WITH n AS (
  SELECT user_id FROM public.customers_extended
  WHERE LOWER(nome) LIKE '%nicola%' AND LOWER(cognome) LIKE '%zucca%'
  LIMIT 1
)
SELECT 'BALANCE' AS what, b.balance::text, b.last_updated::text, NULL AS extra
FROM n JOIN public.user_credit_balance b ON b.user_id = n.user_id
UNION ALL
SELECT 'TX-' || ROW_NUMBER() OVER (ORDER BY t.created_at DESC),
       t.amount::text, t.created_at::text,
       (t.description || ' | ' || COALESCE(t.reference_type, ''))
FROM n JOIN public.credit_transactions t ON t.user_id = n.user_id
ORDER BY 1;
