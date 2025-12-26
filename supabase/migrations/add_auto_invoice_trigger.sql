-- Create a function to automatically generate invoice when booking status changes to 'completed'
CREATE OR REPLACE FUNCTION auto_generate_invoice_on_completion()
RETURNS TRIGGER AS $$
DECLARE
  invoice_exists BOOLEAN;
BEGIN
  -- Only proceed if status changed to 'completed' or 'active' (for car returns)
  IF (NEW.status = 'completed' OR NEW.status = 'active') AND 
     (OLD.status IS NULL OR OLD.status != NEW.status) THEN
    
    -- Check if invoice already exists for this booking
    SELECT EXISTS(
      SELECT 1 FROM fatture WHERE booking_id = NEW.id
    ) INTO invoice_exists;
    
    -- If no invoice exists, trigger the webhook to generate one
    IF NOT invoice_exists THEN
      -- We'll use pg_net to call the Netlify function
      -- Note: This requires pg_net extension to be enabled
      PERFORM
        net.http_post(
          url := 'https://dr7empire.com/.netlify/functions/generate-invoice-from-booking',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := json_build_object('bookingId', NEW.id)::text
        );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on bookings table
DROP TRIGGER IF EXISTS trigger_auto_generate_invoice ON bookings;
CREATE TRIGGER trigger_auto_generate_invoice
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_invoice_on_completion();

-- Add comment
COMMENT ON FUNCTION auto_generate_invoice_on_completion() IS 'Automatically generates invoice when booking status changes to completed';
