-- Update auto-generated car wash bookings to use "Lavaggio Rientro" as customer name
-- This makes them consistent and easier to filter

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
  AND customer_name = 'Auto-generato (Rientro)';

-- Count how many will be updated
SELECT COUNT(*) as total_to_update
FROM bookings
WHERE service_type = 'car_wash'
  AND customer_name = 'Auto-generato (Rientro)';

-- If the preview looks correct, uncomment the UPDATE statement below:

/*
UPDATE bookings
SET customer_name = 'Lavaggio Rientro',
    guest_name = 'Lavaggio Rientro'
WHERE service_type = 'car_wash'
  AND customer_name = 'Auto-generato (Rientro)';
*/

-- Verify the update:
/*
SELECT 
  customer_name,
  COUNT(*) as count
FROM bookings
WHERE service_type = 'car_wash'
  AND (customer_name = 'Lavaggio Rientro' OR customer_name = 'Auto-generato (Rientro)')
GROUP BY customer_name;
*/
