-- Delete auto-generated car wash bookings for vehicle returns
-- These show as "Auto-generato (Rientro)" in the customer name field
-- They should not appear in "Da Saldare" since they are automatic internal operations

-- First, let's see what we're about to delete (PREVIEW)
SELECT 
  id,
  customer_name,
  service_name,
  vehicle_name,
  appointment_date,
  price_total,
  payment_status,
  booking_details
FROM bookings
WHERE service_type = 'car_wash'
  AND customer_name = 'Auto-generato (Rientro)'
  AND payment_status IN ('pending', 'unpaid');

-- If the preview looks correct, uncomment the DELETE statement below:

/*
DELETE FROM bookings
WHERE service_type = 'car_wash'
  AND customer_name = 'Auto-generato (Rientro)'
  AND payment_status IN ('pending', 'unpaid');
*/

-- Note: This will only delete the auto-generated car wash rientri bookings.
-- Regular car wash bookings will NOT be affected.
