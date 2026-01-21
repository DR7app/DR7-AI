-- ============================================
-- INTEGRATION: Auto-create Cauzione from Booking
-- ============================================
-- This migration adds automatic cauzione creation when a booking with a deposit is made

-- Function to auto-create cauzione record when booking is created/updated with deposit
CREATE OR REPLACE FUNCTION auto_create_cauzione_from_booking()
RETURNS TRIGGER AS $$
DECLARE
    deposit_amount NUMERIC;
    vehicle_uuid UUID;
    customer_uuid UUID;
    return_date DATE;
BEGIN
    -- Extract deposit from booking_details JSONB
    deposit_amount := (NEW.booking_details->>'deposit')::NUMERIC;
    
    -- Only proceed if deposit exists and is > 0
    IF deposit_amount IS NOT NULL AND deposit_amount > 0 THEN
        -- Get vehicle ID
        SELECT id INTO vehicle_uuid
        FROM vehicles
        WHERE license_plate = NEW.vehicle_plate
        LIMIT 1;
        
        -- Get customer ID from email
        SELECT id INTO customer_uuid
        FROM customers_extended
        WHERE email = NEW.customer_email
        LIMIT 1;
        
        -- Use return_date as data_restituzione_veicolo
        return_date := NEW.return_date::DATE;
        
        -- Check if cauzione already exists for this booking
        IF NOT EXISTS (
            SELECT 1 FROM cauzioni 
            WHERE riferimento_contratto_id = NEW.id
        ) THEN
            -- Create new cauzione record
            INSERT INTO cauzioni (
                cliente_id,
                veicolo_id,
                riferimento_contratto_id,
                data_restituzione_veicolo,
                importo,
                metodo,
                note
            ) VALUES (
                customer_uuid,
                vehicle_uuid,
                NEW.id,
                return_date,
                deposit_amount,
                'bonifico', -- Default method, can be updated manually
                'Auto-creata da prenotazione #' || NEW.id
            );
        ELSE
            -- Update existing cauzione if booking dates changed
            UPDATE cauzioni
            SET 
                data_restituzione_veicolo = return_date,
                importo = deposit_amount,
                updated_at = NOW()
            WHERE riferimento_contratto_id = NEW.id
              AND stato NOT IN ('Restituita', 'Sbloccata'); -- Don't update terminal states
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on bookings table
-- Note: This assumes your bookings table is called 'bookings'
-- Adjust the table name if different
CREATE TRIGGER trigger_auto_create_cauzione_from_booking
    AFTER INSERT OR UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_cauzione_from_booking();

-- ============================================
-- MIGRATION NOTES
-- ============================================
-- This integration will:
-- 1. Automatically create a cauzione record when a booking with deposit > 0 is created
-- 2. Link the cauzione to the booking via riferimento_contratto_id
-- 3. Auto-update the cauzione when booking return date changes
-- 4. Respect terminal states (Restituita, Sbloccata) - won't update those

-- The cauzione will use:
-- - cliente_id: from customer email lookup
-- - veicolo_id: from vehicle plate lookup  
-- - data_restituzione_veicolo: from booking return_date
-- - importo: from booking_details.deposit
-- - metodo: defaults to 'bonifico' (can be changed manually in Cauzioni tab)

-- IMPORTANT: If your bookings table has a different name or structure,
-- you'll need to adjust the trigger and function accordingly.
