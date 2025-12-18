-- COMPREHENSIVE FIX: Drop and recreate the entire booking availability system
-- Run this in Supabase SQL Editor

-- Step 1: Drop the existing trigger
DROP TRIGGER IF EXISTS check_vehicle_availability_trigger ON bookings;

-- Step 2: Recreate the function with proper UPDATE handling
CREATE OR REPLACE FUNCTION public.check_vehicle_availability()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
  DECLARE
    v_check RECORD;
    v_is_update BOOLEAN;
  BEGIN
    -- Determine if this is an UPDATE operation
    v_is_update := (TG_OP = 'UPDATE');
    
    -- Only validate car rental bookings
    IF (NEW.service_type IS NULL OR NEW.service_type != 'car_wash') AND
       NEW.vehicle_plate IS NOT NULL AND
       NEW.pickup_date IS NOT NULL AND
       NEW.dropoff_date IS NOT NULL AND
       NEW.status IN ('confirmed', 'pending', 'held') THEN

      -- For UPDATE operations, skip validation if dates and vehicle haven't changed
      IF v_is_update AND 
         OLD.vehicle_plate = NEW.vehicle_plate AND
         OLD.pickup_date = NEW.pickup_date AND
         OLD.dropoff_date = NEW.dropoff_date THEN
        -- No conflict check needed - just updating other fields
        RETURN NEW;
      END IF;

      -- Use unified availability check with PLATE
      SELECT * INTO v_check
      FROM check_unified_vehicle_availability(
        NEW.vehicle_plate,
        NEW.pickup_date,
        NEW.dropoff_date,
        NEW.id  -- This excludes the current booking from conflict check
      );

      IF NOT v_check.is_available THEN
        RAISE EXCEPTION '%', v_check.conflict_message;
      END IF;
    END IF;

    RETURN NEW;
  END;
$function$;

-- Step 3: Recreate the trigger
CREATE TRIGGER check_vehicle_availability_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_vehicle_availability();

-- Verify
SELECT 'Trigger recreated successfully!' AS status;
