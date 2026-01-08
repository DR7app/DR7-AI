-- Delete auto-generated car wash bookings that have zero price
-- These are the "Lavaggio Rientro" bookings created automatically for vehicle drop-offs
-- They should not appear in "Da Saldare" since they have no payment required

-- First, let's see what we're about to delete (PREVIEW)
SELECT 
  id,
  customer_name,
  service_name,
  vehicle_name,
  appointment_date,
  price_total,
  payment_status,
  booking_details->>'auto_created' as auto_created
FROM bookings
WHERE service_type = 'car_wash'
  AND price_total = 0
  AND payment_status IN ('pending', 'unpaid')
  AND customer_name = 'Lavaggio Rientro';

-- If the preview looks correct, uncomment the DELETE statement below:

/*
DELETE FROM bookings
WHERE service_type = 'car_wash'
  AND price_total = 0
  AND payment_status IN ('pending', 'unpaid')
  AND customer_name = 'Lavaggio Rientro';
*/

-- Note: This will only delete the auto-generated car wash bookings with zero price.
-- Regular car wash bookings with actual prices will NOT be affected.
