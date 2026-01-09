-- Fix: Update existing car wash booking when rental return date changes
-- This replaces the INSERT-only logic with UPDATE-or-INSERT logic

DROP TRIGGER IF EXISTS trigger_auto_carwash_on_update ON bookings;

CREATE OR REPLACE FUNCTION auto_update_carwash_on_booking_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_appointment_datetime TIMESTAMPTZ;
  v_appointment_date TEXT;
  v_appointment_time TEXT;
  v_end_datetime TIMESTAMPTZ;
  v_existing_carwash RECORD;
  v_next_available_slot TIMESTAMPTZ;
  v_slot_found BOOLEAN := FALSE;
  v_check_datetime TIMESTAMPTZ;
BEGIN
  -- Only process rental bookings
  IF (NEW.service_type IS NULL OR NEW.service_type = 'rental' OR NEW.service_type = 'car_rental') THEN
    
    -- Look for existing auto-created car wash for this rental
    SELECT * INTO v_existing_carwash
    FROM bookings
    WHERE service_type = 'car_wash'
      AND customer_name = 'Lavaggio Rientro'
      AND vehicle_name = NEW.vehicle_name
      AND (
        booking_details->>'source_booking_id' = NEW.id::TEXT
        OR
        -- Fallback: find car wash near the OLD dropoff time
        (appointment_date >= OLD.dropoff_date - INTERVAL '5 minutes'
         AND appointment_date <= OLD.dropoff_date + INTERVAL '2 hours')
      )
      AND status != 'cancelled'
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Start with the new dropoff time as the preferred slot
    v_appointment_datetime := NEW.dropoff_date;
    
    -- Find the next available 45-minute slot
    FOR i IN 0..10 LOOP
      v_check_datetime := v_appointment_datetime + (i * INTERVAL '15 minutes');
      v_end_datetime := v_check_datetime + INTERVAL '45 minutes';
      
      -- Check if this slot conflicts with any existing bookings (excluding the one we're updating)
      IF NOT EXISTS (
        SELECT 1
        FROM bookings
        WHERE (service_type = 'car_wash' OR service_type = 'mechanical_service')
          AND status != 'cancelled'
          AND id != COALESCE(v_existing_carwash.id, '00000000-0000-0000-0000-000000000000'::UUID)
          AND (
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
      ) THEN
        v_next_available_slot := v_check_datetime;
        v_slot_found := TRUE;
        EXIT;
      END IF;
    END LOOP;
    
    -- If we couldn't find a slot, use the dropoff time anyway
    IF NOT v_slot_found THEN
      v_next_available_slot := v_appointment_datetime;
    END IF;
    
    -- Format the appointment date and time
    v_appointment_date := v_next_available_slot::TEXT;
    v_appointment_time := TO_CHAR(v_next_available_slot, 'HH24:MI');
    
    -- UPDATE existing car wash or INSERT new one
    IF v_existing_carwash IS NOT NULL THEN
      -- Update the existing car wash booking
      UPDATE bookings
      SET 
        appointment_date = v_next_available_slot,
        appointment_time = v_appointment_time,
        pickup_date = v_next_available_slot,
        dropoff_date = v_next_available_slot + INTERVAL '45 minutes',
        booking_details = jsonb_set(
          COALESCE(booking_details, '{}'::jsonb),
          '{updated_at}',
          to_jsonb(NOW())
        ),
        updated_at = NOW()
      WHERE id = v_existing_carwash.id;
      
      RAISE NOTICE 'Updated car wash booking % for vehicle % to %', v_existing_carwash.id, NEW.vehicle_name, v_next_available_slot;
    ELSE
      -- Create new car wash booking (same as before)
      INSERT INTO bookings (
        service_type,
        service_name,
        vehicle_name,
        vehicle_plate,
        customer_name,
        guest_name,
        appointment_date,
        appointment_time,
        pickup_date,
        dropoff_date,
        pickup_location,
        dropoff_location,
        price_total,
        currency,
        status,
        payment_status,
        booking_details,
        created_at
      ) VALUES (
        'car_wash',
        'Lavaggio Completo',
        NEW.vehicle_name,
        NEW.vehicle_plate,
        'Lavaggio Rientro',
        'Lavaggio Rientro',
        v_next_available_slot,
        v_appointment_time,
        v_next_available_slot,
        v_next_available_slot + INTERVAL '45 minutes',
        'DR7 Empire - Car Wash',
        'DR7 Empire - Car Wash',
        0,
        'EUR',
        'confirmed',
        'paid',
        jsonb_build_object(
          'auto_created', true,
          'source_booking_id', NEW.id,
          'source_vehicle', NEW.vehicle_name,
          'original_dropoff', NEW.dropoff_date,
          'notes', 'Lavaggio automatico creato al rientro del veicolo'
        ),
        NOW()
      );
      
      RAISE NOTICE 'Created car wash booking for vehicle % at %', NEW.vehicle_name, v_next_available_slot;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on UPDATE (when dropoff date changes)
CREATE TRIGGER trigger_auto_carwash_on_update
  AFTER UPDATE ON bookings
  FOR EACH ROW
  WHEN (
    -- Only trigger when:
    -- 1. It's a rental booking
    (NEW.service_type IS NULL OR NEW.service_type = 'rental' OR NEW.service_type = 'car_rental')
    AND
    -- 2. The booking is not cancelled
    NEW.status != 'cancelled'
    AND
    -- 3. The dropoff_date changed
    OLD.dropoff_date IS DISTINCT FROM NEW.dropoff_date
  )
  EXECUTE FUNCTION auto_update_carwash_on_booking_change();
