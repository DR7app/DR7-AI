-- DEFINITIVE FIX for Da Saldare payment status update
-- This fixes the trigger function permanently
-- Run this ENTIRE script in Supabase SQL Editor

-- Step 1: Replace the broken function with the fixed version
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
        -- FIXED: Use 'plate' instead of 'license_plate'
        SELECT id INTO vehicle_uuid
        FROM vehicles
        WHERE plate = NEW.vehicle_plate
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
                'bonifico',
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
              AND stato NOT IN ('Restituita', 'Sbloccata');
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Recreate the trigger (in case it was dropped)
DROP TRIGGER IF EXISTS trigger_auto_create_cauzione_from_booking ON bookings;

CREATE TRIGGER trigger_auto_create_cauzione_from_booking
    AFTER INSERT OR UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_cauzione_from_booking();

-- Done! The Da Saldare payment status update should now work without timeout errors.
