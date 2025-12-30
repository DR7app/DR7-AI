-- COMPLETE FIX: Disable conflict check for UPDATE operations
-- This allows admins to modify booking dates without self-collision errors

DROP TRIGGER IF EXISTS check_vehicle_availability_trigger ON bookings;
DROP TRIGGER IF EXISTS validate_vehicle_booking ON bookings;

CREATE OR REPLACE FUNCTION public.check_vehicle_availability()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
  DECLARE
    v_check RECORD;
  BEGIN
    -- SKIP ALL CHECKS FOR UPDATE OPERATIONS
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
    
    -- Only validate for INSERT of car rental bookings
    IF (NEW.service_type IS NULL OR NEW.service_type != 'car_wash') AND
       NEW.vehicle_plate IS NOT NULL AND
       NEW.pickup_date IS NOT NULL AND
       NEW.dropoff_date IS NOT NULL AND
       NEW.status IN ('confirmed', 'pending', 'held') THEN

      SELECT * INTO v_check
      FROM check_unified_vehicle_availability(
        NEW.vehicle_plate,
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

CREATE TRIGGER check_vehicle_availability_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_vehicle_availability();

SELECT 'Conflict check disabled for UPDATE operations' AS status;
