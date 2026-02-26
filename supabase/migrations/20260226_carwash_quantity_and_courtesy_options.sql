-- Set price_unit on per-unit extras (enables quantity selector)
UPDATE car_wash_services SET price_unit = 'Qtà' WHERE UPPER(name) LIKE '%CHILD CARE%';
UPDATE car_wash_services SET price_unit = 'Qtà' WHERE UPPER(name) LIKE '%ENGINE CLEAN%';
UPDATE car_wash_services SET price_unit = 'Qtà' WHERE UPPER(name) LIKE '%SEAT CLEAN%';
UPDATE car_wash_services SET price_unit = 'Qtà' WHERE UPPER(name) LIKE '%SEAT PROTECT%';
UPDATE car_wash_services SET price_unit = 'Qtà' WHERE UPPER(name) LIKE '%ODOR CONTROL%';

-- Add price options to Courtesy Drive
UPDATE car_wash_services
SET price_options = '[{"label":"1h","price":9.90},{"label":"2h","price":14.90},{"label":"3h","price":19.90},{"label":"4h","price":23.60},{"label":"5h","price":29.50},{"label":"6h","price":35.40},{"label":"7h","price":41.30}]'::jsonb
WHERE UPPER(name) LIKE '%COURTESY DRIVE%';

-- Add price options to Supercar Experience
UPDATE car_wash_services
SET price_options = '[{"label":"1h","price":89.00},{"label":"2h","price":149.00},{"label":"3h","price":189.00},{"label":"4h","price":276.00},{"label":"5h","price":345.00},{"label":"6h","price":414.00},{"label":"7h","price":483.00}]'::jsonb
WHERE UPPER(name) LIKE '%SUPERCAR EXPERIENCE%';
