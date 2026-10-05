-- 05/10/2026 — BUG: la cauzione di Matteo Stara (GLE 63) risultava intestata
-- a Stefano Antonio Versienti, che non c'entra nulla. La richiesta IBAN e'
-- partita due volte al numero sbagliato.
--
-- Causa: il trigger cercava il cliente con
--   WHERE email = NEW.customer_email OR user_id = NEW.user_id LIMIT 1
-- La prenotazione aveva email vuota ('') e `'' = ''` e' vero: prendeva il
-- primo cliente qualsiasi senza email. In piu' l'OR con LIMIT 1 non dava
-- precedenza a nessuna delle due condizioni.
--
-- Ora, in ordine, e si ferma al primo che trova:
--   1. customers_extended.id = bookings.user_id  (prenotazioni dal gestionale)
--   2. customers_extended.id = booking_details.customer.id
--   3. customers_extended.user_id = bookings.user_id  (account del sito)
-- MAI per email, telefono o nome (decisione direzione 05/10/2026): se la
-- prenotazione non porta la scheda cliente, la cauzione non nasce qui e la
-- crea sync-booking-cauzione dal gestionale.

CREATE OR REPLACE FUNCTION public.auto_create_cauzione_from_booking()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    deposit_amount NUMERIC;
    vehicle_uuid UUID;
    customer_uuid UUID;
    return_date DATE;
    v_cust_text TEXT;
BEGIN
    deposit_amount := COALESCE(
        NEW.deposit_amount,
        (NEW.booking_details->>'deposit')::NUMERIC
    );

    IF deposit_amount IS NOT NULL AND deposit_amount > 0 THEN
        SELECT id INTO vehicle_uuid
        FROM vehicles
        WHERE UPPER(REPLACE(plate, ' ', '')) = UPPER(REPLACE(COALESCE(NEW.vehicle_plate,
            NEW.booking_details->>'vehiclePlate', ''), ' ', ''))
        LIMIT 1;

        IF vehicle_uuid IS NULL AND NEW.vehicle_id IS NOT NULL THEN
            SELECT id INTO vehicle_uuid FROM vehicles WHERE id = NEW.vehicle_id LIMIT 1;
        END IF;

        -- 1. id della scheda cliente = user_id della prenotazione
        IF NEW.user_id IS NOT NULL THEN
            SELECT id INTO customer_uuid FROM customers_extended WHERE id = NEW.user_id;
        END IF;

        -- 2. booking_details.customer.id
        IF customer_uuid IS NULL THEN
            v_cust_text := NULLIF(TRIM(COALESCE(NEW.booking_details->'customer'->>'id', '')), '');
            IF v_cust_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                SELECT id INTO customer_uuid FROM customers_extended WHERE id = v_cust_text::uuid;
            END IF;
        END IF;

        -- 3. account del sito collegato alla scheda
        IF customer_uuid IS NULL AND NEW.user_id IS NOT NULL THEN
            SELECT id INTO customer_uuid FROM customers_extended
            WHERE user_id = NEW.user_id
            ORDER BY created_at DESC
            LIMIT 1;
        END IF;

        return_date := NEW.dropoff_date::DATE;

        IF NOT EXISTS (
            SELECT 1 FROM cauzioni WHERE riferimento_contratto_id = NEW.id
        ) THEN
            IF vehicle_uuid IS NOT NULL AND customer_uuid IS NOT NULL THEN
                INSERT INTO cauzioni (
                    cliente_id, veicolo_id, riferimento_contratto_id,
                    data_restituzione_veicolo, importo, metodo, note
                ) VALUES (
                    customer_uuid, vehicle_uuid, NEW.id,
                    return_date, deposit_amount, 'bonifico',
                    'Auto-creata da prenotazione'
                );
            END IF;
        ELSE
            UPDATE cauzioni SET
                data_restituzione_veicolo = return_date,
                importo = deposit_amount,
                updated_at = NOW()
            WHERE riferimento_contratto_id = NEW.id
              AND stato NOT IN ('Restituita', 'Sbloccata');
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
