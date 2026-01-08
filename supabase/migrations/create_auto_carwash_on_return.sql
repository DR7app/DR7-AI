-- Automatic Car Wash Booking on Rental Creation (UPDATED)
-- This trigger creates a car wash booking IMMEDIATELY when a rental is created
-- The car wash is scheduled at the dropoff_date time

-- Step 1: Drop existing triggers
DROP TRIGGER IF EXISTS trigger_auto_carwash_on_return ON bookings;
DROP TRIGGER IF EXISTS trigger_auto_carwash_on_insert ON bookings;

-- Step 2: Create the updated trigger function
CREATE OR REPLACE FUNCTION auto_create_carwash_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_appointment_datetime TIMESTAMPTZ;
  v_appointment_date TEXT;
  v_appointment_time TEXT;
  v_end_datetime TIMESTAMPTZ;
  v_existing_booking RECORD;
  v_next_available_slot TIMESTAMPTZ;
  v_slot_found BOOLEAN := FALSE;
  v_check_datetime TIMESTAMPTZ;
BEGIN
  -- Only process rental bookings (no service_type or service_type = 'rental')
  IF (NEW.service_type IS NULL OR NEW.service_type = 'rental' OR NEW.service_type = 'car_rental') THEN
    
    -- Check if we already created a car wash for this rental
    -- Look for car wash bookings with matching vehicle and time close to dropoff
    IF EXISTS (
      SELECT 1 FROM bookings
      WHERE service_type = 'car_wash'
        AND vehicle_name = NEW.vehicle_name
        AND appointment_date >= NEW.dropoff_date - INTERVAL '5 minutes'
        AND appointment_date <= NEW.dropoff_date + INTERVAL '2 hours'
        AND status != 'cancelled'
    ) THEN
      -- Car wash already exists for this return, skip
      RAISE NOTICE 'Car wash already exists for vehicle % at return time', NEW.vehicle_name;
      RETURN NEW;
    END IF;

    -- Start with the dropoff time as the preferred slot
    v_appointment_datetime := NEW.dropoff_date;
    
    -- Find the next available 45-minute slot
    -- Check up to 10 slots (2.5 hours) ahead in 15-minute increments
    FOR i IN 0..10 LOOP
      v_check_datetime := v_appointment_datetime + (i * INTERVAL '15 minutes');
      v_end_datetime := v_check_datetime + INTERVAL '45 minutes';
      
      -- Check if this slot conflicts with any existing car wash or mechanical bookings
      SELECT * INTO v_existing_booking
      FROM bookings
      WHERE (service_type = 'car_wash' OR service_type = 'mechanical_service')
        AND status != 'cancelled'
        AND (
          -- Check for overlap: new booking starts before existing ends AND new booking ends after existing starts
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
      IF v_existing_booking IS NULL THEN
        v_next_available_slot := v_check_datetime;
        v_slot_found := TRUE;
        EXIT;
      END IF;
    END LOOP;
    
    -- If we couldn't find a slot, use the dropoff time anyway (admin can resolve)
    IF NOT v_slot_found THEN
      v_next_available_slot := v_appointment_datetime;
      RAISE NOTICE 'Could not find available slot, using dropoff time for vehicle %', NEW.vehicle_name;
    END IF;
    
    -- Format the appointment date and time
    v_appointment_date := v_next_available_slot::TEXT;
    v_appointment_time := TO_CHAR(v_next_available_slot, 'HH24:MI');
    
    -- Create the car wash booking
    INSERT INTO bookings (
      service_type,
      service_name,
      vehicle_name,
      vehicle_plate,
      customer_name,
      customer_email,
      customer_phone,
      guest_name,
      guest_email,
      guest_phone,
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
      NULL,
      NULL,
      'Lavaggio Rientro',
      NULL,
      NULL,
      v_next_available_slot,
      v_appointment_time,
      v_next_available_slot,
      v_next_available_slot + INTERVAL '45 minutes',
      'DR7 Empire - Car Wash',
      'DR7 Empire - Car Wash',
      2500, -- 25 EUR in cents
      'EUR',
      'confirmed',
      'pending',
      jsonb_build_object(
        'auto_created', true,
        'source_booking_id', NEW.id,
        'source_vehicle', NEW.vehicle_name,
        'original_dropoff', NEW.dropoff_date,
        'notes', 'Lavaggio automatico creato al rientro del veicolo'
      ),
      NOW()
    );
    
    RAISE NOTICE 'Auto-created car wash booking for vehicle % at %', NEW.vehicle_name, v_next_available_slot;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Step 3: Create trigger on INSERT (when rental booking is created)
CREATE TRIGGER trigger_auto_carwash_on_insert
  AFTER INSERT ON bookings
  FOR EACH ROW
  WHEN (
    -- Only trigger when it's a rental booking
    (NEW.service_type IS NULL OR NEW.service_type = 'rental' OR NEW.service_type = 'car_rental')
    AND
    -- And the booking is not cancelled
    NEW.status != 'cancelled'
  )
  EXECUTE FUNCTION auto_create_carwash_on_booking();

-- Step 4: Also create trigger on UPDATE (when dropoff date changes)
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
  EXECUTE FUNCTION auto_create_carwash_on_booking();

-- Done! Now car wash bookings are created immediately when you create a rental booking!
