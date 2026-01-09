-- Delete ALL auto-generated car wash rientri bookings from the database
-- This includes bookings with customer names:
-- - "Auto-generato (Rientro)"
-- - "Lavaggio Rientro"

-- First, let's see what we're about to delete (PREVIEW)
SELECT 
  id,
  customer_name,
  service_name,
  vehicle_name,
  appointment_date,
  price_total,
  payment_status,
  status,
  booking_details->>'auto_created' as auto_created
FROM bookings
WHERE service_type = 'car_wash'
  AND (
    customer_name = 'Auto-generato (Rientro)' 
    OR customer_name = 'Lavaggio Rientro'
  )
ORDER BY appointment_date DESC;

-- Count how many will be deleted
SELECT 
  COUNT(*) as total_to_delete,
  SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count,
  SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
  SUM(CASE WHEN payment_status = 'unpaid' THEN 1 ELSE 0 END) as unpaid_count
FROM bookings
WHERE service_type = 'car_wash'
  AND (
    customer_name = 'Auto-generato (Rientro)' 
    OR customer_name = 'Lavaggio Rientro'
  );

-- If the preview looks correct, uncomment the DELETE statement below:

/*
DELETE FROM bookings
WHERE service_type = 'car_wash'
  AND (
    customer_name = 'Auto-generato (Rientro)' 
    OR customer_name = 'Lavaggio Rientro'
  );
*/

-- After deletion, verify the cleanup:
/*
SELECT COUNT(*) as remaining_auto_generated
FROM bookings
WHERE service_type = 'car_wash'
  AND (
    customer_name = 'Auto-generato (Rientro)' 
    OR customer_name = 'Lavaggio Rientro'
  );
*/
