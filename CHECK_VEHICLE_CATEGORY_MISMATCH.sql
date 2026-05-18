-- Show what category id is REALLY stored on the Mercedes vehicles +
-- what Centralina Pro has for each. If the vehicle.category id matches
-- a Centralina Pro entry labelled "Urban", the scheda will print "Urban"
-- even if a SECOND entry labelled "Hypercar" exists in the config.

-- 1. The vehicles
SELECT
  v.id, v.display_name, v.plate,
  v.category                       AS stored_category_id,
  v.created_at, v.updated_at
FROM public.vehicles v
WHERE v.display_name ILIKE '%mercedes%'
ORDER BY v.display_name;

-- 2. The full Centralina Pro categories list
SELECT
  jsonb_array_elements(config -> 'categories') AS category
FROM public.centralina_pro_config
WHERE id = 'main';
