-- Create car wash bookings for ALL existing rental bookings
-- This is a one-time script to backfill car wash bookings for existing rentals

-- Step 1: First, let's see how many rentals need car wash bookings
SELECT 
  COUNT(*) as total_rentals_needing_carwash
FROM bookings b
WHERE (b.service_type IS NULL OR b.service_type = 'rental' OR b.service_type = 'car_rental')
  AND b.status != 'cancelled'
  AND b.dropoff_date >= NOW() - INTERVAL '30 days'  -- Only last 30 days and future
  AND NOT EXISTS (
    SELECT 1 FROM bookings cw
    WHERE cw.service_type = 'car_wash'
      AND cw.vehicle_name = b.vehicle_name
      AND cw.appointment_date >= b.dropoff_date - INTERVAL '5 minutes'
      AND cw.appointment_date <= b.dropoff_date + INTERVAL '2 hours'
      AND cw.status != 'cancelled'
  );

-- Step 2: Create car wash bookings for all existing rentals
-- This uses the same logic as the trigger
DO $$
DECLARE
  rental_record RECORD;
  v_appointment_datetime TIMESTAMPTZ;
  v_appointment_time TEXT;
  v_end_datetime TIMESTAMPTZ;
  v_existing_booking RECORD;
  v_next_available_slot TIMESTAMPTZ;
  v_slot_found BOOLEAN;
  v_check_datetime TIMESTAMPTZ;
  v_created_count INTEGER := 0;
BEGIN
  -- Loop through all rental bookings that need car wash
  FOR rental_record IN 
    SELECT *
    FROM bookings b
    WHERE (b.service_type IS NULL OR b.service_type = 'rental' OR b.service_type = 'car_rental')
      AND b.status != 'cancelled'
      AND b.dropoff_date >= NOW() - INTERVAL '30 days'  -- Only last 30 days and future
      AND NOT EXISTS (
        SELECT 1 FROM bookings cw
        WHERE cw.service_type = 'car_wash'
          AND cw.vehicle_name = b.vehicle_name
          AND cw.appointment_date >= b.dropoff_date - INTERVAL '5 minutes'
          AND cw.appointment_date <= b.dropoff_date + INTERVAL '2 hours'
          AND cw.status != 'cancelled'
      )
    ORDER BY b.dropoff_date
  LOOP
    -- Start with the dropoff time as the preferred slot
    v_appointment_datetime := rental_record.dropoff_date;
    v_slot_found := FALSE;
    
    -- Find the next available 45-minute slot
    FOR i IN 0..10 LOOP
      v_check_datetime := v_appointment_datetime + (i * INTERVAL '15 minutes');
      v_end_datetime := v_check_datetime + INTERVAL '45 minutes';
      
      -- Check if this slot conflicts with any existing car wash or mechanical bookings
      SELECT * INTO v_existing_booking
      FROM bookings
      WHERE (service_type = 'car_wash' OR service_type = 'mechanical_service')
        AND status != 'cancelled'
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
      LIMIT 1;
      
      -- If no conflict found, we have our slot
      IF v_existing_booking IS NULL THEN
        v_next_available_slot := v_check_datetime;
        v_slot_found := TRUE;
        EXIT;
      END IF;
    END LOOP;
    
    -- If we couldn't find a slot, use the dropoff time anyway
    IF NOT v_slot_found THEN
      v_next_available_slot := v_appointment_datetime;
    END IF;
    
    -- Format the appointment time
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
      rental_record.vehicle_name,
      rental_record.vehicle_plate,
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
        'backfilled', true,
        'source_booking_id', rental_record.id,
        'source_vehicle', rental_record.vehicle_name,
        'original_dropoff', rental_record.dropoff_date,
        'notes', 'Lavaggio automatico creato al rientro del veicolo (backfilled)'
      ),
      NOW()
    );
    
    v_created_count := v_created_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Created % car wash bookings for existing rentals', v_created_count;
END $$;

-- Step 3: Verify the car wash bookings were created
SELECT 
  COUNT(*) as total_carwash_bookings,
  COUNT(CASE WHEN booking_details->>'backfilled' = 'true' THEN 1 END) as backfilled_bookings
FROM bookings
WHERE service_type = 'car_wash'
  AND appointment_date >= NOW() - INTERVAL '30 days';

-- Step 4: Show a sample of the created bookings
SELECT 
  id,
  vehicle_name,
  service_name,
  appointment_date,
  appointment_time,
  status,
  booking_details->>'auto_created' as auto_created,
  booking_details->>'backfilled' as backfilled,
  booking_details->>'source_vehicle' as source_vehicle
FROM bookings
WHERE service_type = 'car_wash'
  AND booking_details->>'backfilled' = 'true'
ORDER BY appointment_date
LIMIT 20;
