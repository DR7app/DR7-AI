-- Daily wallet-interest accruals for Nicolas Vladimiro (DR7 Club).
-- Returns one row per day the cron has accrued interest for him.
SELECT
  accrual_date,
  principal_eur,
  rate_pct,
  accrual_eur,
  created_at
FROM public.wallet_interest_accruals
WHERE user_id = (
  SELECT user_id
  FROM public.customers_extended
  WHERE LOWER(nome)    LIKE '%nicolas%'
    AND LOWER(cognome) LIKE '%vladimiro%'
  LIMIT 1
)
ORDER BY accrual_date DESC
LIMIT 30;
