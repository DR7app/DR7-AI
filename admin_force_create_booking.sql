-- ADMIN FORCE CREATE BOOKING
-- This function allows admins to create bookings that bypass the vehicle availability trigger
-- Use case: When admin KNOWS they need to double-book a vehicle (e.g., back-to-back rentals)

CREATE OR REPLACE FUNCTION public.admin_force_create_booking(
  p_booking_data jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_result json;
  v_new_id uuid;
BEGIN
  -- Temporarily disable triggers by setting session to replica mode
  SET session_replication_role = replica;

  -- Insert the booking
  INSERT INTO bookings (
    id,
    user_id,
    vehicle_id,
    vehicle_plate,
    vehicle_name,
    pickup_date,
    dropoff_date,
    pickup_location,
    dropoff_location,
    customer_name,
    customer_email,
    customer_phone,
    total_amount,
    amount_paid,
    payment_status,
    currency,
    status,
    booking_source,
    service_type,
    booking_details,
    booked_at,
    created_at,
    updated_at
  )
  VALUES (
    COALESCE((p_booking_data->>'id')::uuid, gen_random_uuid()),
    (p_booking_data->>'user_id')::uuid,
    (p_booking_data->>'vehicle_id')::uuid,
    p_booking_data->>'vehicle_plate',
    p_booking_data->>'vehicle_name',
    (p_booking_data->>'pickup_date')::timestamp with time zone,
    (p_booking_data->>'dropoff_date')::timestamp with time zone,
    p_booking_data->>'pickup_location',
    p_booking_data->>'dropoff_location',
    p_booking_data->>'customer_name',
    p_booking_data->>'customer_email',
    p_booking_data->>'customer_phone',
    COALESCE((p_booking_data->>'total_amount')::numeric, 0),
    COALESCE((p_booking_data->>'amount_paid')::numeric, 0),
    COALESCE(p_booking_data->>'payment_status', 'pending'),
    COALESCE(p_booking_data->>'currency', 'EUR'),
    COALESCE(p_booking_data->>'status', 'confirmed'),
    COALESCE(p_booking_data->>'booking_source', 'admin'),
    p_booking_data->>'service_type',
    COALESCE(p_booking_data->'booking_details', '{}'::jsonb),
    COALESCE((p_booking_data->>'booked_at')::timestamp with time zone, NOW()),
    NOW(),
    NOW()
  )
  RETURNING id INTO v_new_id;

  -- Re-enable triggers
  SET session_replication_role = DEFAULT;

  -- Return the created booking
  SELECT json_build_object(
    'success', true,
    'id', id,
    'customer_name', customer_name,
    'vehicle_name', vehicle_name,
    'pickup_date', pickup_date,
    'dropoff_date', dropoff_date,
    'status', status
  ) INTO v_result
  FROM bookings
  WHERE id = v_new_id;

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Make sure to re-enable triggers even on error
  SET session_replication_role = DEFAULT;
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$function$;

-- Grant execute permission to authenticated users (admin)
GRANT EXECUTE ON FUNCTION public.admin_force_create_booking TO authenticated;

SELECT 'admin_force_create_booking function created successfully' as status;
