-- Debug: Check the exact times of the overlapping car washes
SELECT 
  id,
  customer_name,
  vehicle_name,
  vehicle_plate,
  appointment_date,
  appointment_time,
  dropoff_date,
  service_name,
  booking_details->>'source_booking_id' as source_rental_id,
  created_at
FROM bookings
WHERE service_type = 'car_wash'
  AND customer_name = 'Lavaggio Rientro'
  AND status != 'cancelled'
ORDER BY appointment_date DESC
LIMIT 10;
