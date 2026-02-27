-- Add ABSOLUTE DETAIL WASH for MAXI category
-- Copies all fields from the existing urban version, changing only category and id
INSERT INTO car_wash_services (
  id, name, name_en, price, duration, description, description_en,
  features, features_en, display_order, is_active, category, main_tab,
  price_unit, price_options
)
SELECT
  id || '-maxi',
  name,
  name_en,
  price,
  duration,
  description,
  description_en,
  features,
  features_en,
  display_order,
  is_active,
  'maxi',
  main_tab,
  price_unit,
  price_options
FROM car_wash_services
WHERE UPPER(name) LIKE '%ABSOLUTE DETAIL%'
  AND category = 'urban'
  AND NOT EXISTS (
    SELECT 1 FROM car_wash_services
    WHERE UPPER(name) LIKE '%ABSOLUTE DETAIL%' AND category = 'maxi'
  );
