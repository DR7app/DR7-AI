-- Fill the card-display fields we have from Nexi's merchant portal.
-- The masked PAN isn't on the page you screenshotted — leave it null for
-- now; if Nexi shows it elsewhere paste the digits and we'll add it.

UPDATE public.customers_extended
SET metadata = metadata || jsonb_build_object(
    'nexi_card_circuit',     'VISA',
    'nexi_card_brand',       'VISA',
    'nexi_card_type',        'debit',
    'nexi_card_country',     'BEL',
    'nexi_card_expiry',      '09/2030',
    'nexi_auth_code',        '436380'
  )
WHERE LOWER(email) = LOWER('manolcherch19@icloud.com');

-- Verify
SELECT id,
       metadata ->> 'nexi_contract_id'  AS contract_id,
       metadata ->> 'nexi_card_circuit' AS circuit,
       metadata ->> 'nexi_card_brand'   AS brand,
       metadata ->> 'nexi_card_type'    AS card_type,
       metadata ->> 'nexi_card_country' AS country,
       metadata ->> 'nexi_card_expiry'  AS expiry,
       metadata ->> 'nexi_card_masked_pan' AS masked_pan
FROM public.customers_extended
WHERE LOWER(email) = LOWER('manolcherch19@icloud.com');
