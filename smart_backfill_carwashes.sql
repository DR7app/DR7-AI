-- Smart backfill: Fix out-of-sync car washes while respecting 45-minute buffer
-- This updates car washes to match their rental dropoff dates, but finds available slots if conflicts exist

DO $$
DECLARE
  v_carwash RECORD;
  v_rental RECORD;
  v_new_slot TIMESTAMPTZ;
  v_slot_found BOOLEAN;
  v_check_datetime TIMESTAMPTZ;
  v_end_datetime TIMESTAMPTZ;
  v_conflict RECORD;
  v_updated_count INTEGER := 0;
BEGIN
  -- Loop through all out-of-sync car washes
  FOR v_carwash IN (
    SELECT 
      cw.id as carwash_id,
      cw.appointment_date as current_appointment,
      r.id as rental_id,
      r.dropoff_date as rental_dropoff,
      r.vehicle_name,
      r.vehicle_plate
    FROM bookings cw
    JOIN bookings r ON cw.booking_details->>'source_booking_id' = r.id::text
    WHERE cw.service_type = 'car_wash'
      AND cw.customer_name = 'Lavaggio Rientro'
      AND cw.status != 'cancelled'
      AND r.status != 'cancelled'
      AND (r.service_type IS NULL OR r.service_type IN ('rental', 'car_rental'))
      AND r.dropoff_date != cw.appointment_date
    ORDER BY r.dropoff_date
  ) LOOP
    
    -- Try to find an available slot starting from the rental's dropoff time
    v_slot_found := FALSE;
    
    FOR i IN 0..10 LOOP
      v_check_datetime := v_carwash.rental_dropoff + (i * INTERVAL '15 minutes');
      v_end_datetime := v_check_datetime + INTERVAL '45 minutes';
      
      -- Check for conflicts (excluding the car wash we're updating)
      SELECT * INTO v_conflict
      FROM bookings
      WHERE (service_type = 'car_wash' OR service_type = 'mechanical_service')
        AND status != 'cancelled'
        AND id != v_carwash.carwash_id  -- Exclude the one we're updating
        AND (
          v_check_datetime < (appointment_date + INTERVAL '1 minute' * 
            CASE 
              WHEN service_name = 'Lavaggio Completo' THEN 45
              WHEN service_name = 'Lavaggio Top' THEN 90
              WHEN service_name = 'Lavaggio VIP' THEN 120
              WHEN service_name = 'Lavaggio DR7 Luxury' THEN 150
              WHEN service_type = 'mechanical_service' THEN 60
              ELSE 45
            END
          )
          AND
          v_end_datetime > appointment_date
        )
      LIMIT 1;
      
      -- If no conflict, we found our slot
      IF v_conflict IS NULL THEN
        v_new_slot := v_check_datetime;
        v_slot_found := TRUE;
        EXIT;
      END IF;
    END LOOP;
    
    -- If no slot found, use the dropoff time anyway (admin will need to resolve)
    IF NOT v_slot_found THEN
      v_new_slot := v_carwash.rental_dropoff;
      RAISE WARNING 'No available slot found for car wash % (vehicle %), using dropoff time', 
        v_carwash.carwash_id, v_carwash.vehicle_name;
    END IF;
    
    -- Update the car wash
    UPDATE bookings
    SET 
      appointment_date = v_new_slot,
      appointment_time = TO_CHAR(v_new_slot, 'HH24:MI'),
      pickup_date = v_new_slot,
      dropoff_date = v_new_slot + INTERVAL '45 minutes',
      booking_details = booking_details || jsonb_build_object(
        'backfilled_at', NOW(),
        'previous_appointment_date', v_carwash.current_appointment,
        'synced_with_rental', v_carwash.rental_id,
        'slot_offset_minutes', EXTRACT(EPOCH FROM (v_new_slot - v_carwash.rental_dropoff)) / 60
      )
    WHERE id = v_carwash.carwash_id;
    
    v_updated_count := v_updated_count + 1;
    
    RAISE NOTICE 'Updated car wash % for vehicle % from % to % (offset: % min)', 
      v_carwash.carwash_id,
      v_carwash.vehicle_name,
      v_carwash.current_appointment,
      v_new_slot,
      EXTRACT(EPOCH FROM (v_new_slot - v_carwash.rental_dropoff)) / 60;
  END LOOP;
  
  RAISE NOTICE 'Backfill complete: % car washes updated', v_updated_count;
END $$;

-- Verify the results
SELECT 
  cw.id,
  cw.vehicle_name,
  cw.vehicle_plate,
  cw.appointment_date as carwash_time,
  r.dropoff_date as rental_dropoff,
  EXTRACT(EPOCH FROM (cw.appointment_date - r.dropoff_date)) / 60 as offset_minutes,
  cw.booking_details->>'slot_offset_minutes' as recorded_offset
FROM bookings cw
JOIN bookings r ON cw.booking_details->>'source_booking_id' = r.id::text
WHERE cw.service_type = 'car_wash'
  AND cw.customer_name = 'Lavaggio Rientro'
  AND cw.status != 'cancelled'
  AND cw.booking_details->>'backfilled_at' IS NOT NULL
ORDER BY cw.appointment_date DESC
LIMIT 20;
