-- Find duplicate car washes (multiple car washes for the same rental)
SELECT 
  r.id as rental_id,
  r.vehicle_name,
  r.vehicle_plate,
  r.dropoff_date,
  COUNT(cw.id) as carwash_count,
  ARRAY_AGG(cw.id) as carwash_ids,
  ARRAY_AGG(cw.created_at ORDER BY cw.created_at) as creation_times
FROM bookings r
LEFT JOIN bookings cw ON cw.booking_details->>'source_booking_id' = r.id::text
WHERE (r.service_type IS NULL OR r.service_type IN ('rental', 'car_rental'))
  AND cw.service_type = 'car_wash'
  AND cw.customer_name = 'Lavaggio Rientro'
  AND cw.status != 'cancelled'
  AND r.status != 'cancelled'
GROUP BY r.id, r.vehicle_name, r.vehicle_plate, r.dropoff_date
HAVING COUNT(cw.id) > 1
ORDER BY COUNT(cw.id) DESC, r.dropoff_date DESC;
