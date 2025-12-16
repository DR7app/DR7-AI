-- Fix vehicle availability check to use vehicle_plate instead of vehicle_name
-- This allows multiple cars with the same model name but different plates

-- Step 1: Drop the old function
DROP FUNCTION IF EXISTS public.check_unified_vehicle_availability(text, timestamp with time zone, timestamp with time zone, uuid);

-- Step 2: Create new function with vehicle_plate parameter
CREATE OR REPLACE FUNCTION public.check_unified_vehicle_availability(
  p_vehicle_plate text,  -- Now uses plate instead of name
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
    -- First, clean up expired holds
    PERFORM release_expired_holds();

    -- Check for conflicts BY VEHICLE PLATE (not name)
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
    WHERE vehicle_plate = p_vehicle_plate  -- FIXED: Check by plate instead of name
      AND service_type IS DISTINCT FROM 'car_wash'
      AND id != COALESCE(p_exclude_booking_id, '00000000-0000-0000-0000-000000000000'::uuid)
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

-- Step 3: Update the trigger function to pass vehicle_plate instead of vehicle_name
CREATE OR REPLACE FUNCTION public.check_vehicle_availability()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
  DECLARE
    v_check RECORD;
  BEGIN
    -- Only validate car rental bookings
    IF (NEW.service_type IS NULL OR NEW.service_type != 'car_wash') AND
       NEW.vehicle_plate IS NOT NULL AND  -- FIXED: Check for plate instead of name
       NEW.pickup_date IS NOT NULL AND
       NEW.dropoff_date IS NOT NULL AND
       NEW.status IN ('confirmed', 'pending', 'held') THEN

      -- Use unified availability check with PLATE
      SELECT * INTO v_check
      FROM check_unified_vehicle_availability(
        NEW.vehicle_plate,  -- FIXED: Pass plate instead of name
        NEW.pickup_date,
        NEW.dropoff_date,
        NEW.id
      );

      IF NOT v_check.is_available THEN
        RAISE EXCEPTION '%', v_check.conflict_message;
      END IF;
    END IF;

    RETURN NEW;
  END;
$function$;

-- Verify the fix
SELECT 'Vehicle availability check now uses vehicle_plate instead of vehicle_name!' AS status;
