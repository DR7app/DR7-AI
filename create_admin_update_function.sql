-- ADMIN BYPASS: Create a function to update bookings without trigger interference
-- This allows admins to modify bookings directly

CREATE OR REPLACE FUNCTION public.admin_update_booking(
  p_booking_id uuid,
  p_pickup_date timestamp with time zone,
  p_dropoff_date timestamp with time zone,
  p_vehicle_plate text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_payment_status text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_result json;
BEGIN
  -- Disable the trigger temporarily for this session
  SET session_replication_role = replica;
  
  -- Update the booking
  UPDATE bookings
  SET 
    pickup_date = COALESCE(p_pickup_date, pickup_date),
    dropoff_date = COALESCE(p_dropoff_date, dropoff_date),
    vehicle_plate = COALESCE(p_vehicle_plate, vehicle_plate),
    status = COALESCE(p_status, status),
    payment_status = COALESCE(p_payment_status, payment_status),
    updated_at = NOW()
  WHERE id = p_booking_id
  RETURNING json_build_object(
    'id', id,
    'customer_name', customer_name,
    'vehicle_name', vehicle_name,
    'pickup_date', pickup_date,
    'dropoff_date', dropoff_date,
    'status', status
  ) INTO v_result;
  
  -- Re-enable triggers
  SET session_replication_role = DEFAULT;
  
  RETURN v_result;
END;
$function$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.admin_update_booking TO authenticated;

SELECT 'Admin booking update function created!' AS status;
