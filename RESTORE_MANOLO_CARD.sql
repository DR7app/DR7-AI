-- Restore Manolo Cherchi's tokenized card reference after it was
-- mistakenly flagged "RIFERIMENTO RIMOSSO" (status orphan_removed).
--
-- Two updates inside a single transaction:
--   1. Mark the nexi_transactions row back to 'preauth_held' so it appears
--      as a tokenized card again in NexiTab.
--   2. Re-attach the contract_id (which is the Nexi card token) onto the
--      customer's customers_extended.metadata.nexi_contract_id so future
--      MIT charges / auto-recharge can use it.
--
-- The contract_id (order_id "P3e957d2emp795woz") and customer email
-- (manolcherch19@icloud.com) come from the screenshot. Adjust the WHERE
-- clauses if the order id is different.

BEGIN;

-- 1. Bring the transaction back from orphan to held
UPDATE public.nexi_transactions
SET status = 'preauth_held',
    updated_at = NOW()
WHERE order_id = 'P3e957d2emp795woz'
   OR contract_id = 'P3e957d2emp795woz';

-- 2. Re-attach the contract_id on the customer
UPDATE public.customers_extended
SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{nexi_contract_id}',
      '"P3e957d2emp795woz"'::jsonb
    )
WHERE LOWER(email) = LOWER('manolcherch19@icloud.com')
   OR (LOWER(nome) LIKE '%manolo%' AND LOWER(cognome) LIKE '%cherchi%');

-- Verify
SELECT 'tx' AS what, order_id, contract_id, status
FROM public.nexi_transactions
WHERE order_id = 'P3e957d2emp795woz'
   OR contract_id = 'P3e957d2emp795woz';

SELECT 'cust' AS what, id, nome, cognome, email,
       metadata ->> 'nexi_contract_id' AS contract_id_now
FROM public.customers_extended
WHERE LOWER(email) = LOWER('manolcherch19@icloud.com')
   OR (LOWER(nome) LIKE '%manolo%' AND LOWER(cognome) LIKE '%cherchi%');

COMMIT;
