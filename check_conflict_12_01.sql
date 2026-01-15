-- Check for the specific booking being edited
-- Looking for Renault Clio orange (GS58623) bookings around 01/12/2026 - 01/13/2026

SELECT 
    id,
    vehicle_name,
    vehicle_plate,
    pickup_date,
    dropoff_date,
    status,
    customer_name,
    service_type
FROM bookings
WHERE (vehicle_name ILIKE '%clio%orange%' OR vehicle_plate = 'GS58623')
  AND status != 'cancelled'
  AND (
    pickup_date::date BETWEEN '2026-01-11' AND '2026-01-14'
    OR dropoff_date::date BETWEEN '2026-01-11' AND '2026-01-14'
  )
ORDER BY pickup_date;

-- Check for ANY car wash bookings on 2026-01-12 or 2026-12-01
SELECT 
    id,
    service_type,
    service_name,
    vehicle_name,
    appointment_date,
    appointment_time,
    pickup_date,
    dropoff_date,
    status
FROM bookings
WHERE service_type = 'car_wash'
  AND status != 'cancelled'
  AND (
    appointment_date IN ('2026-01-12', '2026-12-01')
    OR pickup_date::date IN ('2026-01-12', '2026-12-01')
  )
ORDER BY appointment_date, appointment_time;
