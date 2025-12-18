-- ULTIMATE FIX: Fix the check_unified_vehicle_availability function
-- The problem is that the exclusion logic (p_exclude_booking_id) is not working

-- Drop and recreate the function with proper exclusion
CREATE OR REPLACE FUNCTION public.check_unified_vehicle_availability(
  p_vehicle_plate text,
  p_start_time timestamp with time zone,
  p_end_time timestamp with time zone,
  p_exclude_booking_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(is_available boolean, conflicting_booking_id uuid, conflict_message text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
  DECLARE
    v_conflict_count integer;
    v_conflict_id uuid;
    v_conflict_source text;
    v_conflict_status text;
  BEGIN
    -- Check for conflicts BY VEHICLE PLATE
    SELECT
      COUNT(*),
      (ARRAY_AGG(id ORDER BY created_at DESC))[1], 
      (ARRAY_AGG(booking_source ORDER BY created_at DESC))[1],
      (ARRAY_AGG(status ORDER BY created_at DESC))[1]
    INTO
      v_conflict_count,
      v_conflict_id,
      v_conflict_source,
      v_conflict_status
    FROM public.bookings
    WHERE vehicle_plate = p_vehicle_plate
      AND service_type IS DISTINCT FROM 'car_wash'
      -- CRITICAL FIX: Properly exclude the booking being edited
      AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
      AND (
        (status IN ('confirmed', 'pending') AND payment_status IN ('succeeded', 'completed', 'paid'))
        OR status = 'held'
      )
      AND (
        (p_start_time >= pickup_date AND p_start_time < dropoff_date) OR
        (p_end_time > pickup_date AND p_end_time <= dropoff_date) OR
        (p_start_time <= pickup_date AND p_end_time >= dropoff_date)
      );

    IF v_conflict_count > 0 THEN
      RETURN QUERY SELECT
        false,
        v_conflict_id,
        format('Vehicle already %s via %s (Booking ID: %s)',
          CASE WHEN v_conflict_status = 'held' THEN 'held' ELSE 'booked' END,
          v_conflict_source,
          v_conflict_id
        );
    ELSE
      RETURN QUERY SELECT true, NULL::uuid, NULL::text;
    END IF;
  END;
$function$;

-- Verify the fix
SELECT 'check_unified_vehicle_availability function fixed!' AS status;
