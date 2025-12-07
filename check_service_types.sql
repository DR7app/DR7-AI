-- Check what service_type values exist in unpaid bookings
SELECT 
  service_type,
  COUNT(*) as count,
  STRING_AGG(DISTINCT customer_name, ', ') as example_customers
FROM bookings
WHERE payment_status IN ('pending', 'unpaid')
  AND status != 'cancelled'
GROUP BY service_type
ORDER BY count DESC;

-- Show sample of bookings with NULL or unusual service_type
SELECT 
  id,
  service_type,
  customer_name,
  vehicle_name,
  service_name,
  created_at
FROM bookings
WHERE payment_status IN ('pending', 'unpaid')
  AND status != 'cancelled'
  AND service_type NOT IN ('rental', 'car_wash', 'mechanical_service')
ORDER BY created_at DESC
LIMIT 10;
