-- ============================================
-- FIX CAUZIONI INTEGRATION
-- Run this in Supabase SQL Editor
-- ============================================

-- Step 1: Drop and recreate the trigger function with correct column names
DROP FUNCTION IF EXISTS auto_create_cauzione_from_booking() CASCADE;

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
        -- Get vehicle ID from plate (normalize: remove spaces, uppercase)
        SELECT id INTO vehicle_uuid
        FROM vehicles
        WHERE UPPER(REPLACE(plate, ' ', '')) = UPPER(REPLACE(COALESCE(NEW.vehicle_plate, NEW.booking_details->>'vehiclePlate', ''), ' ', ''))
        LIMIT 1;

        -- Get customer ID from email or user_id
        SELECT id INTO customer_uuid
        FROM customers_extended
        WHERE email = NEW.customer_email OR user_id = NEW.user_id
        LIMIT 1;

        -- Use dropoff_date as data_restituzione_veicolo
        return_date := NEW.dropoff_date::DATE;

        -- Check if cauzione already exists for this booking
        IF NOT EXISTS (
            SELECT 1 FROM cauzioni
            WHERE riferimento_contratto_id = NEW.id
        ) THEN
            -- Only create if we have both vehicle and customer
            IF vehicle_uuid IS NOT NULL AND customer_uuid IS NOT NULL THEN
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
                    'Auto-creata da prenotazione'
                );
            END IF;
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

-- Step 2: Recreate trigger on bookings table
DROP TRIGGER IF EXISTS trigger_auto_create_cauzione_from_booking ON bookings;

CREATE TRIGGER trigger_auto_create_cauzione_from_booking
    AFTER INSERT OR UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_cauzione_from_booking();

-- Step 3: Migrate existing bookings that have deposits but no cauzioni
INSERT INTO cauzioni (
    cliente_id,
    veicolo_id,
    riferimento_contratto_id,
    data_restituzione_veicolo,
    importo,
    metodo,
    note
)
SELECT
    ce.id as cliente_id,
    v.id as veicolo_id,
    b.id as riferimento_contratto_id,
    b.dropoff_date::DATE as data_restituzione_veicolo,
    (b.booking_details->>'deposit')::NUMERIC as importo,
    'bonifico' as metodo,
    'Migrata da prenotazione esistente' as note
FROM bookings b
LEFT JOIN customers_extended ce ON (ce.email = b.customer_email OR ce.user_id = b.user_id)
LEFT JOIN vehicles v ON UPPER(REPLACE(v.plate, ' ', '')) = UPPER(REPLACE(COALESCE(b.vehicle_plate, b.booking_details->>'vehiclePlate', ''), ' ', ''))
WHERE
    (b.booking_details->>'deposit')::NUMERIC > 0
    AND NOT EXISTS (SELECT 1 FROM cauzioni c WHERE c.riferimento_contratto_id = b.id)
    AND ce.id IS NOT NULL
    AND v.id IS NOT NULL;

-- Step 4: Show summary of what was created
SELECT
    'Cauzioni create: ' || COUNT(*) as risultato
FROM cauzioni
WHERE note LIKE '%Migrata%' OR note LIKE '%Auto-creata%';

-- Step 5: List all cauzioni for verification
SELECT
    c.id,
    COALESCE(ce.denominazione, ce.nome || ' ' || ce.cognome) as cliente,
    v.display_name as veicolo,
    v.plate as targa,
    c.importo,
    c.data_restituzione_veicolo,
    c.scadenza_cauzione,
    c.stato,
    c.metodo
FROM cauzioni c
LEFT JOIN customers_extended ce ON c.cliente_id = ce.id
LEFT JOIN vehicles v ON c.veicolo_id = v.id
ORDER BY c.created_at DESC
LIMIT 20;
