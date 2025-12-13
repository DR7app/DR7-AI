-- Check what service_type values exist in bookings
SELECT service_type, COUNT(*) as count
FROM bookings
WHERE pickup_date IS NOT NULL
GROUP BY service_type
ORDER BY count DESC;
