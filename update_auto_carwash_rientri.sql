-- Update auto-generated car wash bookings:
-- 1. Change customer name from "Auto-generato (Rientro)" to "Lavaggio Rientro"
-- 2. Set price_total to 0 (instead of 2500 cents = €25)

-- First, preview what will be updated
SELECT 
  id,
  customer_name,
  service_name,
  vehicle_name,
  appointment_date,
  price_total,
  payment_status
FROM bookings
WHERE service_type = 'car_wash'
  AND (customer_name = 'Auto-generato (Rientro)' OR customer_name = 'Lavaggio Rientro');

-- Count how many will be updated
SELECT 
  customer_name,
  COUNT(*) as count,
  SUM(price_total) as total_price
FROM bookings
WHERE service_type = 'car_wash'
  AND (customer_name = 'Auto-generato (Rientro)' OR customer_name = 'Lavaggio Rientro')
GROUP BY customer_name;

-- If the preview looks correct, uncomment the UPDATE statement below:

/*
UPDATE bookings
SET 
  customer_name = 'Lavaggio Rientro',
  guest_name = 'Lavaggio Rientro',
  price_total = 0,
  payment_status = 'paid'  -- Set to paid since there's nothing to pay
WHERE service_type = 'car_wash'
  AND (customer_name = 'Auto-generato (Rientro)' OR customer_name = 'Lavaggio Rientro');
*/

-- Verify the update:
/*
SELECT 
  customer_name,
  COUNT(*) as count,
  AVG(price_total) as avg_price,
  SUM(price_total) as total_price
FROM bookings
WHERE service_type = 'car_wash'
  AND customer_name = 'Lavaggio Rientro'
GROUP BY customer_name;
*/
