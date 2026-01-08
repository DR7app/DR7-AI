-- Fix ALL auto-generated car wash bookings
-- 1. Update customer name from "Auto-generato (Rientro)" to "Lavaggio Rientro"
-- 2. Set price to €0

-- Step 1: Update all auto-generated car wash bookings
UPDATE bookings
SET 
  customer_name = 'Lavaggio Rientro',
  guest_name = 'Lavaggio Rientro',
  price_total = 0
WHERE service_type = 'car_wash'
  AND (
    customer_name = 'Auto-generato (Rientro)' 
    OR customer_name = 'Lavaggio Rientro'
  );

-- Step 2: Verify the changes
SELECT 
  COUNT(*) as total_updated,
  COUNT(CASE WHEN price_total = 0 THEN 1 END) as with_zero_price,
  COUNT(CASE WHEN customer_name = 'Lavaggio Rientro' THEN 1 END) as with_correct_name
FROM bookings
WHERE service_type = 'car_wash'
  AND customer_name = 'Lavaggio Rientro';

-- Step 3: Show sample of updated bookings
SELECT 
  id,
  customer_name,
  vehicle_name,
  service_name,
  appointment_date,
  appointment_time,
  price_total / 100.0 as price_euros,
  payment_status,
  status
FROM bookings
WHERE service_type = 'car_wash'
  AND customer_name = 'Lavaggio Rientro'
ORDER BY appointment_date DESC
LIMIT 30;
