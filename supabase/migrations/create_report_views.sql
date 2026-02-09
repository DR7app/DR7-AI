-- Report views for booking analysis with correct billable day calculation.
-- Business rule: start day inclusive, checkout (end) day exclusive.
-- Feb 6 → Feb 7 = 1 billable day. Same-day bookings = 1 day minimum.
-- Each row is keyed by booking_id + targa (never aggregated by vehicle name).

-- 1) Per-booking detail view
CREATE OR REPLACE VIEW report_booking_details AS
SELECT
  b.id AS booking_id,
  COALESCE(v.plate, b.vehicle_plate, '-') AS targa,
  v.id AS vehicle_id,
  v.display_name AS vehicle_name,
  v.category AS vehicle_category,
  b.pickup_date AS start_at,
  b.dropoff_date AS end_at,
  b.status,
  -- Billable days: date difference (start inclusive, end exclusive), minimum 1
  GREATEST(1, (b.dropoff_date::date - b.pickup_date::date)) AS billable_days,
  -- Total price in euros (stored as cents in DB)
  ROUND(COALESCE(b.price_total, 0) / 100.0, 2) AS total_price_eur,
  -- Revenue per billable day
  CASE
    WHEN GREATEST(1, (b.dropoff_date::date - b.pickup_date::date)) > 0
    THEN ROUND(
      COALESCE(b.price_total, 0) / 100.0
      / GREATEST(1, (b.dropoff_date::date - b.pickup_date::date)),
      2
    )
    ELSE 0
  END AS revenue_per_day
FROM bookings b
LEFT JOIN vehicles v ON v.id = b.vehicle_id
WHERE
  b.pickup_date IS NOT NULL
  AND b.dropoff_date IS NOT NULL
  AND COALESCE(b.service_type, '') NOT IN ('car_wash', 'mechanical_service', 'mechanical')
  AND b.status IN ('confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending')
  AND COALESCE((b.booking_details->>'internal')::boolean, false) = false
  AND COALESCE(b.booking_details->>'createdBy', '') != 'automatic_system';


-- 2) Daily occupancy view: one row per occupied date per booking.
-- Uses generate_series to expand booking date ranges.
-- Start date inclusive, checkout (end) date exclusive.
-- For same-day bookings (pickup == dropoff), includes that one day.
CREATE OR REPLACE VIEW report_daily_occupancy AS
SELECT
  b.id AS booking_id,
  COALESCE(v.plate, b.vehicle_plate, '-') AS targa,
  v.id AS vehicle_id,
  v.display_name AS vehicle_name,
  d.occupied_date,
  EXTRACT(YEAR FROM d.occupied_date)::int AS year,
  EXTRACT(MONTH FROM d.occupied_date)::int AS month,
  EXTRACT(DAY FROM d.occupied_date)::int AS day
FROM bookings b
LEFT JOIN vehicles v ON v.id = b.vehicle_id
CROSS JOIN LATERAL generate_series(
  b.pickup_date::date,
  -- Same-day bookings: include that day; otherwise exclude checkout day
  CASE
    WHEN b.pickup_date::date = b.dropoff_date::date THEN b.pickup_date::date
    ELSE (b.dropoff_date::date - INTERVAL '1 day')::date
  END,
  '1 day'::interval
) AS d(occupied_date)
WHERE
  b.pickup_date IS NOT NULL
  AND b.dropoff_date IS NOT NULL
  AND COALESCE(b.service_type, '') NOT IN ('car_wash', 'mechanical_service', 'mechanical')
  AND b.status IN ('confirmed', 'confermata', 'completed', 'completata', 'in_corso', 'active', 'pending')
  AND COALESCE((b.booking_details->>'internal')::boolean, false) = false
  AND COALESCE(b.booking_details->>'createdBy', '') != 'automatic_system';


-- Example queries:
--
-- Per-vehicle monthly summary (aggregated from booking-level data):
--   SELECT targa, vehicle_name, vehicle_category,
--          COUNT(DISTINCT booking_id) AS bookings_count,
--          SUM(total_price_eur) AS total_revenue,
--          SUM(billable_days) AS total_billable_days
--   FROM report_booking_details
--   WHERE start_at >= '2026-02-01' AND start_at < '2026-03-01'
--   GROUP BY targa, vehicle_name, vehicle_category;
--
-- Monthly occupancy count per vehicle (no double-counting):
--   SELECT targa, vehicle_name, year, month,
--          COUNT(DISTINCT occupied_date) AS occupied_days
--   FROM report_daily_occupancy
--   WHERE year = 2026 AND month = 2
--   GROUP BY targa, vehicle_name, year, month;
