-- Add €420 to Nicola Vladimiro Zucca's wallet. Run once.

WITH n AS (
  SELECT user_id FROM public.customers_extended
  WHERE LOWER(nome) LIKE '%nicola%' AND LOWER(cognome) LIKE '%zucca%'
  LIMIT 1
)
INSERT INTO public.user_credit_balance (user_id, balance, last_updated)
SELECT user_id, 420, NOW() FROM n
ON CONFLICT (user_id) DO UPDATE
  SET balance = user_credit_balance.balance + 420,
      last_updated = NOW();

INSERT INTO public.credit_transactions (user_id, transaction_type, amount, balance_after, description, reference_type)
SELECT
  n.user_id, 'credit', 420, b.balance,
  'Ricarica wallet automatica — €420 (15 mag 2026)',
  'wallet_auto_recharge'
FROM public.customers_extended n
JOIN public.user_credit_balance b ON b.user_id = n.user_id
WHERE LOWER(n.nome) LIKE '%nicola%' AND LOWER(n.cognome) LIKE '%zucca%';
