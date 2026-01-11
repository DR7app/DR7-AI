-- Create trigger to automatically update linked "Lavaggio Rientro" booking when rental dropoff date changes
-- This ensures that when a rental is extended (or dropoff date is modified), the car wash booking is updated

-- Step 1: Create the trigger function
CREATE OR REPLACE FUNCTION update_linked_carwash_on_rental_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_appointment_datetime TIMESTAMPTZ;
  v_new_appointment_time TEXT;
  v_existing_booking RECORD;
  v_next_available_slot TIMESTAMPTZ;
  v_slot_found BOOLEAN := FALSE;
  v_check_datetime TIMESTAMPTZ;
  v_end_datetime TIMESTAMPTZ;
BEGIN
  -- Only process when dropoff_date changes for a rental booking
  IF (NEW.dropoff_date != OLD.dropoff_date) THEN
    -- Check if this is a rental booking
    IF (NEW.service_type IS NULL OR NEW.service_type = 'rental' OR NEW.service_type = 'car_rental') THEN
      
      -- Find the linked car wash booking
      SELECT * INTO v_existing_booking
      FROM bookings
      WHERE service_type = 'car_wash'
        AND customer_name = 'Lavaggio Rientro'
        AND booking_details->>'source_booking_id' = NEW.id::text
        AND status != 'cancelled'
      LIMIT 1;
      
      -- If a linked car wash exists, update its appointment date
      IF FOUND THEN
        -- Start with the new dropoff time as the preferred slot
        v_new_appointment_datetime := NEW.dropoff_date;
        
        -- Find the next available 45-minute slot
        -- Check up to 10 slots (2.5 hours) ahead in 15-minute increments
        FOR i IN 0..10 LOOP
          v_check_datetime := v_new_appointment_datetime + (i * INTERVAL '15 minutes');
          v_end_datetime := v_check_datetime + INTERVAL '45 minutes';
          
          -- Check if this slot conflicts with any existing car wash or mechanical bookings
          -- (excluding the current car wash booking we're updating)
          SELECT * INTO v_existing_booking
          FROM bookings
          WHERE (service_type = 'car_wash' OR service_type = 'mechanical_service')
            AND status != 'cancelled'
            AND id != v_existing_booking.id  -- Exclude the booking we're updating
            AND (
              -- Check for overlap
              (v_check_datetime < (appointment_date + INTERVAL '1 minute' * 
                CASE 
                  WHEN service_name = 'Lavaggio Completo' THEN 45
                  WHEN service_name = 'Lavaggio Top' THEN 90
                  WHEN service_name = 'Lavaggio VIP' THEN 120
                  WHEN service_name = 'Lavaggio DR7 Luxury' THEN 150
                  ELSE 60
                END
              ))
              AND
              (v_end_datetime > appointment_date)
            )
          LIMIT 1;
          
          -- If no conflict found, we have our slot
          IF NOT FOUND THEN
            v_next_available_slot := v_check_datetime;
            v_slot_found := TRUE;
            EXIT;
          END IF;
        END LOOP;
        
        -- If we couldn't find a slot, use the dropoff time anyway (admin can resolve)
        IF NOT v_slot_found THEN
          v_next_available_slot := v_new_appointment_datetime;
          RAISE NOTICE 'Could not find available slot, using new dropoff time for vehicle %', NEW.vehicle_name;
        END IF;
        
        -- Format the new appointment time
        v_new_appointment_time := TO_CHAR(v_next_available_slot, 'HH24:MI');
        
        -- Update the linked car wash booking
        UPDATE bookings
        SET 
          appointment_date = v_next_available_slot,
          appointment_time = v_new_appointment_time,
          pickup_date = v_next_available_slot,
          dropoff_date = v_next_available_slot + INTERVAL '45 minutes',
          booking_details = booking_details || jsonb_build_object(
            'original_dropoff', NEW.dropoff_date,
            'updated_at', NOW()
          )
        WHERE id = v_existing_booking.id;
        
        RAISE NOTICE 'Updated linked car wash booking for rental % to new time %', NEW.id, v_next_available_slot;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Step 2: Create the trigger (if it doesn't exist)
DROP TRIGGER IF EXISTS update_linked_carwash_trigger ON bookings;

CREATE TRIGGER update_linked_carwash_trigger
AFTER UPDATE ON bookings
FOR EACH ROW
WHEN (NEW.dropoff_date IS DISTINCT FROM OLD.dropoff_date)
EXECUTE FUNCTION update_linked_carwash_on_rental_change();

-- Step 3: Verify the trigger was created
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'update_linked_carwash_trigger';
-- Create trigger to automatically cancel linked "Lavaggio Rientro" booking when rental is cancelled
-- This ensures that when a rental booking is cancelled, the associated car wash booking is also cancelled

-- Step 1: Create the trigger function
CREATE OR REPLACE FUNCTION cancel_linked_carwash_on_rental_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only process when a rental booking is being cancelled
  IF (NEW.status = 'cancelled' AND OLD.status != 'cancelled') THEN
    -- Check if this is a rental booking
    IF (NEW.service_type IS NULL OR NEW.service_type = 'rental' OR NEW.service_type = 'car_rental') THEN
      
      -- Cancel any linked car wash booking
      UPDATE bookings
      SET status = 'cancelled'
      WHERE service_type = 'car_wash'
        AND customer_name = 'Lavaggio Rientro'
        AND booking_details->>'source_booking_id' = NEW.id::text
        AND status != 'cancelled';
      
      RAISE NOTICE 'Cancelled linked car wash booking for rental %', NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Step 2: Create the trigger (if it doesn't exist)
DROP TRIGGER IF EXISTS cancel_linked_carwash_trigger ON bookings;

CREATE TRIGGER cancel_linked_carwash_trigger
AFTER UPDATE ON bookings
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
EXECUTE FUNCTION cancel_linked_carwash_on_rental_cancel();

-- Step 3: Verify the trigger was created
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'cancel_linked_carwash_trigger';
