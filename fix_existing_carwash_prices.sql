-- Update existing auto-generated car wash bookings to €0
-- This fixes the bookings that were already created with €25

UPDATE bookings
SET price_total = 0
WHERE service_type = 'car_wash'
  AND customer_name = 'Lavaggio Rientro'
  AND price_total = 2500;  -- Only update those with €25

-- Verify the update
SELECT 
  id,
  customer_name,
  vehicle_name,
  service_name,
  appointment_date,
  price_total / 100.0 as price_euros,
  payment_status
FROM bookings
WHERE service_type = 'car_wash'
  AND customer_name = 'Lavaggio Rientro'
ORDER BY appointment_date DESC
LIMIT 20;
