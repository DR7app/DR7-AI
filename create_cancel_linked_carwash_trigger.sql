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
