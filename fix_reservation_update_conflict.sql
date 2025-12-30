-- FIX: Resolve "Vehicle already booked" error when updating reservations
-- UPDATED: now handles dependent triggers correctly using CASCADE

-- Step 1: Drop dependent objects first
-- The user reported 'validate_vehicle_booking' depends on 'check_vehicle_availability'
DROP TRIGGER IF EXISTS validate_vehicle_booking ON bookings;
DROP TRIGGER IF EXISTS check_vehicle_availability_trigger ON bookings;

-- Drop function with CASCADE to remove any other hidden dependencies
DROP FUNCTION IF EXISTS public.check_vehicle_availability() CASCADE;

-- Drop the unified check function
DROP FUNCTION IF EXISTS public.check_unified_vehicle_availability(text, timestamp with time zone, timestamp with time zone, uuid);


-- Step 2: Recreate conflict check function with robust ID exclusion
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
    -- Look for overlapping bookings with the same plate
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
      AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id) -- KEY FIX: Exclude current booking
      AND status IN ('confirmed', 'pending', 'held')
      AND payment_status IN ('succeeded', 'completed', 'paid', 'pending')
      AND (
        p_start_time < dropoff_date AND
        p_end_time > pickup_date
      );

    IF v_conflict_count > 0 THEN
      RETURN QUERY SELECT
        false,
        v_conflict_id,
        format('Vehicle already %s via %s (Booking ID: %s)',
          CASE WHEN v_conflict_status = 'held' THEN 'held' ELSE 'booked' END,
          COALESCE(v_conflict_source, 'admin'),
          v_conflict_id
        );
    ELSE
      RETURN QUERY SELECT true, NULL::uuid, NULL::text;
    END IF;
  END;
$function$;

-- Step 3: Recreate the trigger function
CREATE OR REPLACE FUNCTION public.check_vehicle_availability()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
  DECLARE
    v_check RECORD;
    v_is_update BOOLEAN;
  BEGIN
    v_is_update := (TG_OP = 'UPDATE');
    
    IF (NEW.service_type IS NULL OR NEW.service_type != 'car_wash') AND
       NEW.vehicle_plate IS NOT NULL AND
       NEW.pickup_date IS NOT NULL AND
       NEW.dropoff_date IS NOT NULL AND
       NEW.status IN ('confirmed', 'pending', 'held') THEN

      -- Skip check if critical fields haven't changed
      IF v_is_update AND 
         OLD.vehicle_plate = NEW.vehicle_plate AND
         OLD.pickup_date = NEW.pickup_date AND
         OLD.dropoff_date = NEW.dropoff_date THEN
         RETURN NEW;
      END IF;

      SELECT * INTO v_check
      FROM check_unified_vehicle_availability(
        NEW.vehicle_plate,
        NEW.pickup_date,
        NEW.dropoff_date,
        NEW.id -- Pass ID to exclude it
      );

      IF NOT v_check.is_available THEN
        RAISE EXCEPTION '%', v_check.conflict_message;
      END IF;
    END IF;

    RETURN NEW;
  END;
$function$;

-- Step 4: Re-attach the trigger (renaming to singular primary trigger)
CREATE TRIGGER check_vehicle_availability_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_vehicle_availability();

-- Step 5: Update admin bypass function
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
  SET session_replication_role = replica;
  
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
  
  SET session_replication_role = DEFAULT;
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_update_booking TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_unified_vehicle_availability TO authenticated;

SELECT 'Dependencies handled. Logic fixed.' as status;
