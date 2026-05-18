-- Fix the misleading "Pre-autorizzato" badge for Manolo Cherchi:
-- the €590 was actually CAPTURED, not just held. Also pull any masked PAN
-- info that lives on the tx row over onto the customer's metadata so the
-- card number shows in NexiTab.

BEGIN;

-- 1. Flip status from preauth_held → preauth_captured (label "Catturato")
UPDATE public.nexi_transactions
SET status = 'preauth_captured',
    updated_at = NOW()
WHERE order_id = 'P3e957d2emp795woz';

-- 2. Copy masked_pan / circuit / card_type / card_brand from the tx's
-- metadata over to the customer's metadata so the number reappears.
-- (Each key only overwrites if the tx actually has a value for it —
-- COALESCE keeps current customer-side value otherwise.)
UPDATE public.customers_extended ce
SET metadata = ce.metadata
  || jsonb_build_object(
       'nexi_card_masked_pan',
       COALESCE(
         (SELECT metadata ->> 'masked_pan'              FROM public.nexi_transactions WHERE order_id = 'P3e957d2emp795woz'),
         (SELECT metadata ->> 'nexi_card_masked_pan'    FROM public.nexi_transactions WHERE order_id = 'P3e957d2emp795woz'),
         ce.metadata ->> 'nexi_card_masked_pan'
       ),
       'nexi_card_circuit',
       COALESCE(
         (SELECT metadata ->> 'circuit'                 FROM public.nexi_transactions WHERE order_id = 'P3e957d2emp795woz'),
         (SELECT metadata ->> 'nexi_card_circuit'       FROM public.nexi_transactions WHERE order_id = 'P3e957d2emp795woz'),
         ce.metadata ->> 'nexi_card_circuit'
       ),
       'nexi_card_type',
       COALESCE(
         (SELECT metadata ->> 'card_type'               FROM public.nexi_transactions WHERE order_id = 'P3e957d2emp795woz'),
         (SELECT metadata ->> 'nexi_card_type'          FROM public.nexi_transactions WHERE order_id = 'P3e957d2emp795woz'),
         ce.metadata ->> 'nexi_card_type'
       ),
       'nexi_card_brand',
       COALESCE(
         (SELECT metadata ->> 'card_brand'              FROM public.nexi_transactions WHERE order_id = 'P3e957d2emp795woz'),
         (SELECT metadata ->> 'nexi_card_brand'         FROM public.nexi_transactions WHERE order_id = 'P3e957d2emp795woz'),
         ce.metadata ->> 'nexi_card_brand'
       )
     )
WHERE LOWER(email) = LOWER('manolcherch19@icloud.com');

-- Verify
SELECT 'tx-after' AS what, order_id, status, metadata
FROM public.nexi_transactions
WHERE order_id = 'P3e957d2emp795woz';

SELECT 'cust-after' AS what, id,
       metadata ->> 'nexi_contract_id'     AS contract_id,
       metadata ->> 'nexi_card_masked_pan' AS masked_pan,
       metadata ->> 'nexi_card_circuit'    AS circuit,
       metadata ->> 'nexi_card_brand'      AS brand
FROM public.customers_extended
WHERE LOWER(email) = LOWER('manolcherch19@icloud.com');

COMMIT;
