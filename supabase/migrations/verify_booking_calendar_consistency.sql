-- Database function to verify booking-calendar consistency
-- This function checks for potential linkage issues between bookings and vehicles

CREATE OR REPLACE FUNCTION verify_booking_calendar_consistency()
RETURNS TABLE (
  issue_type TEXT,
  booking_id UUID,
  vehicle_id UUID,
  vehicle_name TEXT,
  vehicle_plate TEXT,
  current_vehicle_plate TEXT,
  details TEXT
) AS $$
BEGIN
  -- Check 1: Bookings with missing vehicle_id
  RETURN QUERY
  SELECT 
    'MISSING_VEHICLE_ID'::TEXT as issue_type,
    b.id as booking_id,
    b.vehicle_id,
    b.vehicle_name,
    b.vehicle_plate,
    NULL::TEXT as current_vehicle_plate,
    'Booking has no vehicle_id - relies on name/plate matching only'::TEXT as details
  FROM bookings b
  WHERE b.vehicle_id IS NULL
    AND b.status != 'cancelled'
    AND b.service_type IS NULL; -- Only rental bookings

  -- Check 2: Bookings with vehicle_id pointing to non-existent vehicle
  RETURN QUERY
  SELECT 
    'ORPHANED_BOOKING'::TEXT as issue_type,
    b.id as booking_id,
    b.vehicle_id,
    b.vehicle_name,
    b.vehicle_plate,
    NULL::TEXT as current_vehicle_plate,
    'Booking references a vehicle_id that does not exist'::TEXT as details
  FROM bookings b
  LEFT JOIN vehicles v ON b.vehicle_id = v.id
  WHERE b.vehicle_id IS NOT NULL
    AND v.id IS NULL
    AND b.status != 'cancelled'
    AND b.service_type IS NULL;

  -- Check 3: Bookings where vehicle_plate doesn't match current vehicle plate
  RETURN QUERY
  SELECT 
    'PLATE_MISMATCH'::TEXT as issue_type,
    b.id as booking_id,
    b.vehicle_id,
    b.vehicle_name,
    b.vehicle_plate,
    v.plate as current_vehicle_plate,
    CONCAT('Booking plate "', b.vehicle_plate, '" does not match current vehicle plate "', v.plate, '"')::TEXT as details
  FROM bookings b
  INNER JOIN vehicles v ON b.vehicle_id = v.id
  WHERE b.vehicle_plate IS NOT NULL
    AND v.plate IS NOT NULL
    AND UPPER(REPLACE(b.vehicle_plate, ' ', '')) != UPPER(REPLACE(v.plate, ' ', ''))
    AND b.status != 'cancelled'
    AND b.service_type IS NULL;

  -- Check 4: Bookings where vehicle_name doesn't match current vehicle display_name
  RETURN QUERY
  SELECT 
    'NAME_MISMATCH'::TEXT as issue_type,
    b.id as booking_id,
    b.vehicle_id,
    b.vehicle_name,
    b.vehicle_plate,
    v.plate as current_vehicle_plate,
    CONCAT('Booking name "', b.vehicle_name, '" does not match current vehicle name "', v.display_name, '"')::TEXT as details
  FROM bookings b
  INNER JOIN vehicles v ON b.vehicle_id = v.id
  WHERE LOWER(TRIM(b.vehicle_name)) != LOWER(TRIM(v.display_name))
    AND b.status != 'cancelled'
    AND b.service_type IS NULL;

  -- Check 5: Bookings with missing vehicle_plate (warning, not critical)
  RETURN QUERY
  SELECT 
    'MISSING_PLATE'::TEXT as issue_type,
    b.id as booking_id,
    b.vehicle_id,
    b.vehicle_name,
    b.vehicle_plate,
    v.plate as current_vehicle_plate,
    'Booking has no vehicle_plate stored - may cause matching issues'::TEXT as details
  FROM bookings b
  INNER JOIN vehicles v ON b.vehicle_id = v.id
  WHERE b.vehicle_plate IS NULL
    AND v.plate IS NOT NULL
    AND b.status != 'cancelled'
    AND b.service_type IS NULL;

END;
$$ LANGUAGE plpgsql;

-- Create a view for easy access to consistency report
CREATE OR REPLACE VIEW booking_consistency_report AS
SELECT * FROM verify_booking_calendar_consistency();

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION verify_booking_calendar_consistency() TO authenticated;
GRANT SELECT ON booking_consistency_report TO authenticated;

-- Example usage:
-- SELECT * FROM verify_booking_calendar_consistency();
-- or
-- SELECT * FROM booking_consistency_report;
