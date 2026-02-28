-- Update car wash service durations to correct values per category
-- Urban durations
UPDATE car_wash_services SET duration = '40 min' WHERE UPPER(name) LIKE '%INTERIOR%' AND category = 'urban';
UPDATE car_wash_services SET duration = '30 min' WHERE UPPER(name) LIKE '%EXTERIOR%' AND category = 'urban';
UPDATE car_wash_services SET duration = '80 min' WHERE UPPER(name) LIKE '%FULL CLEAN N2%' AND category = 'urban';
UPDATE car_wash_services SET duration = '80 min' WHERE UPPER(name) LIKE '%FULL CLEAN%' AND category = 'urban' AND UPPER(name) NOT LIKE '%N2%';
UPDATE car_wash_services SET duration = '120 min' WHERE UPPER(name) LIKE '%TOP SHINE%' AND category = 'urban';
UPDATE car_wash_services SET duration = '140 min' WHERE UPPER(name) LIKE '%VIP EXPERIENCE%' AND category = 'urban';
UPDATE car_wash_services SET duration = '220 min' WHERE UPPER(name) LIKE '%LUXURY DETAIL%' AND category = 'urban';

-- Maxi durations
UPDATE car_wash_services SET duration = '45 min' WHERE UPPER(name) LIKE '%INTERIOR%' AND category = 'maxi';
UPDATE car_wash_services SET duration = '40 min' WHERE UPPER(name) LIKE '%EXTERIOR%' AND category = 'maxi';
UPDATE car_wash_services SET duration = '90 min' WHERE UPPER(name) LIKE '%FULL CLEAN N2%' AND category = 'maxi';
UPDATE car_wash_services SET duration = '90 min' WHERE UPPER(name) LIKE '%FULL CLEAN%' AND category = 'maxi' AND UPPER(name) NOT LIKE '%N2%';
UPDATE car_wash_services SET duration = '130 min' WHERE UPPER(name) LIKE '%TOP SHINE%' AND category = 'maxi';
UPDATE car_wash_services SET duration = '150 min' WHERE UPPER(name) LIKE '%VIP EXPERIENCE%' AND category = 'maxi';
UPDATE car_wash_services SET duration = '280 min' WHERE UPPER(name) LIKE '%LUXURY DETAIL%' AND category = 'maxi';
