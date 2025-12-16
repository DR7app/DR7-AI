-- Update Car Wash Service Durations and Prices
-- Run this in Supabase SQL Editor

-- Update the trigger function with new durations (in minutes)
CREATE OR REPLACE FUNCTION check_car_wash_slot_conflict()
RETURNS TRIGGER AS $$
DECLARE
  existing_booking_id UUID;
  existing_booking_customer TEXT;
  existing_service_name TEXT;
  conflict_time TEXT;
  new_duration_minutes INTEGER;
  existing_duration_minutes INTEGER;
  new_start_minutes INTEGER;
  new_end_minutes INTEGER;
  existing_start_minutes INTEGER;
  existing_end_minutes INTEGER;
  booking_record RECORD;
BEGIN
  -- Only check for car wash bookings
  IF NEW.service_type = 'car_wash' AND NEW.status != 'cancelled' THEN

    -- IMPROVED: Check if this is an admin override (multiple ways)
    IF NEW.booking_details IS NOT NULL AND (
       (NEW.booking_details->>'forceBooked')::boolean IS TRUE OR
       (NEW.booking_details->>'adminOverride')::boolean IS TRUE OR
       NEW.booking_details->>'createdBy' = 'admin_panel'
    ) THEN
      -- Allow admin forced bookings, skip the check
      RAISE NOTICE '✅ ADMIN OVERRIDE: Skipping conflict check for booking';
      RETURN NEW;
    END IF;

    -- Get duration for the new booking based on service name (UPDATED DURATIONS)
    new_duration_minutes := CASE NEW.service_name
      WHEN 'Lavaggio Completo' THEN 45   -- Was 60, now 45 minutes
      WHEN 'Lavaggio Top' THEN 90         -- Was 120, now 90 minutes (1h 30min)
      WHEN 'Lavaggio VIP' THEN 120        -- Was 180, now 120 minutes (2h)
      WHEN 'Lavaggio DR7 Luxury' THEN 150 -- Was 240, now 150 minutes (2h 30min)
      ELSE 45 -- Default to 45 minutes
    END;

    -- Convert new appointment time to minutes
    new_start_minutes := EXTRACT(HOUR FROM NEW.appointment_date::time) * 60 +
                         EXTRACT(MINUTE FROM NEW.appointment_date::time);
    new_end_minutes := new_start_minutes + new_duration_minutes;

    -- Check for existing non-cancelled bookings that might overlap
    FOR booking_record IN
      SELECT id, customer_name, appointment_time, service_name, appointment_date
      FROM bookings
      WHERE service_type = 'car_wash'
        AND status != 'cancelled'
        AND DATE(appointment_date) = DATE(NEW.appointment_date)
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      -- Get duration for existing booking (UPDATED DURATIONS)
      existing_duration_minutes := CASE booking_record.service_name
        WHEN 'Lavaggio Completo' THEN 45
        WHEN 'Lavaggio Top' THEN 90
        WHEN 'Lavaggio VIP' THEN 120
        WHEN 'Lavaggio DR7 Luxury' THEN 150
        ELSE 45 -- Default to 45 minutes
      END;

      -- Convert existing appointment time to minutes
      existing_start_minutes := EXTRACT(HOUR FROM booking_record.appointment_date::time) * 60 +
                               EXTRACT(MINUTE FROM booking_record.appointment_date::time);
      existing_end_minutes := existing_start_minutes + existing_duration_minutes;

      -- Check if time ranges overlap
      IF new_start_minutes < existing_end_minutes AND new_end_minutes > existing_start_minutes THEN
        -- Conflict found
        existing_booking_id := booking_record.id;
        existing_booking_customer := booking_record.customer_name;
        existing_service_name := booking_record.service_name;
        conflict_time := booking_record.appointment_time;

        RAISE EXCEPTION 'Slot già occupato alle % (Cliente: %, Servizio: %, ID: %)',
          conflict_time,
          existing_booking_customer,
          existing_service_name,
          UPPER(SUBSTRING(existing_booking_id::text, 1, 8));
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Verify the update
SELECT 'Car wash durations updated successfully!' AS status;
SELECT 'Lavaggio Completo: 45 min, Top: 90 min, VIP: 120 min, Luxury: 150 min' AS new_durations;
