-- 2026-06-04: FIX — il bypass "auto di cortesia" era stato aggiunto alla funzione
-- SBAGLIATA (check_vehicle_availability, vedi 20260604_courtesy_block_bypass_vehicle_conflict.sql),
-- che NON è il trigger attivo. Il blocco doppia-prenotazione reale è
-- prevent_overlapping_bookings() (trigger trg_prevent_overlapping_bookings).
-- Per questo i blocchi auto di cortesia continuavano a fallire con
-- "CONFLICT_DOUBLE_BOOKING ... already booked in the requested window".
--
-- Qui aggiungiamo il bypass nella funzione GIUSTA, sia per i blocchi cortesia
-- (booking_details.is_courtesy_block=true) che per i blocchi supercar experience
-- (is_supercar_experience_block=true): shadow rental che occupano volutamente un
-- veicolo già prenotato, approvati via OTP direzionale lato admin PRIMA
-- dell'insert. Restano comunque conteggiati come occupazione per le prenotazioni
-- future (il blocco continua a funzionare).
CREATE OR REPLACE FUNCTION public.prevent_overlapping_bookings()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
    DECLARE
      conflict_count INTEGER;
    BEGIN
      IF (NEW.vehicle_id IS NULL AND NEW.vehicle_plate IS NULL)
         OR NEW.pickup_date IS NULL
         OR NEW.dropoff_date IS NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.status IN ('cancelled','annullata','completed','completata','expired') THEN
        RETURN NEW;
      END IF;

      IF NEW.vehicle_plate IN ('TEST000', 'TEST002') THEN
        RETURN NEW;
      END IF;

      IF NEW.service_type = 'car_wash' THEN
        RETURN NEW;
      END IF;

      -- 2026-06-03: Uscita Straordinaria (movimenti interni) bypassa il check.
      IF NEW.service_type = 'uscita_straordinaria' THEN
        RETURN NEW;
      END IF;

      IF NEW.customer_name = 'Lavaggio Rientro' THEN
        RETURN NEW;
      END IF;

      -- 2026-06-04: blocchi "auto di cortesia" / "supercar experience".
      IF COALESCE(NEW.booking_details->>'is_courtesy_block', '') = 'true'
         OR COALESCE(NEW.booking_details->>'is_supercar_experience_block', '') = 'true' THEN
        RETURN NEW;
      END IF;

      SELECT COUNT(*) INTO conflict_count
      FROM bookings
      WHERE id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND status NOT IN ('cancelled','annullata','completed','completata','expired')
        AND service_type IS DISTINCT FROM 'car_wash'
        AND service_type IS DISTINCT FROM 'uscita_straordinaria'
        AND customer_name IS DISTINCT FROM 'Lavaggio Rientro'
        AND (vehicle_plate IS NULL OR vehicle_plate NOT IN ('TEST000', 'TEST002'))
        AND (
          (NEW.vehicle_id IS NOT NULL AND vehicle_id = NEW.vehicle_id)
          OR (NEW.vehicle_plate IS NOT NULL AND vehicle_plate = NEW.vehicle_plate)
        )
        AND pickup_date < NEW.dropoff_date
        AND dropoff_date > NEW.pickup_date;

      IF conflict_count > 0 THEN
        RAISE EXCEPTION 'CONFLICT_DOUBLE_BOOKING: Vehicle % (% / %) already booked in the requested window (% -> %). Found % conflicting booking(s).',
          COALESCE(NEW.vehicle_name, 'unknown'),
          NEW.vehicle_plate,
          NEW.vehicle_id,
          NEW.pickup_date,
          NEW.dropoff_date,
          conflict_count
          USING ERRCODE = 'unique_violation';
      END IF;

      RETURN NEW;
    END;
    $function$;
