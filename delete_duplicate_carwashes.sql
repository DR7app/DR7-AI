-- Delete duplicate car washes, keeping only the oldest one for each rental
-- This removes extra car washes that were created by mistake

WITH duplicates AS (
  SELECT 
    cw.id as carwash_id,
    cw.booking_details->>'source_booking_id' as rental_id,
    cw.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY cw.booking_details->>'source_booking_id' 
      ORDER BY cw.created_at ASC
    ) as row_num
  FROM bookings cw
  WHERE cw.service_type = 'car_wash'
    AND cw.customer_name = 'Lavaggio Rientro'
    AND cw.status != 'cancelled'
    AND cw.booking_details->>'source_booking_id' IS NOT NULL
)
DELETE FROM bookings
WHERE id IN (
  SELECT carwash_id 
  FROM duplicates 
  WHERE row_num > 1
)
RETURNING 
  id,
  vehicle_name,
  vehicle_plate,
  appointment_date,
  booking_details->>'source_booking_id' as source_rental;
