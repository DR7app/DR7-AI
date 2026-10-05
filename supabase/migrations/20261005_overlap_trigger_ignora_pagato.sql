-- ============================================================
-- "Pagato" bloccato da CONFLICT_DOUBLE_BOOKING (Manuel Fanni 05/10/2026).
-- Il trigger scatta su UPDATE OF status: segnare pagato scrive
-- status='confirmed' e rifaceva il controllo sovrapposizioni su una
-- prenotazione GIA' esistente e gia' attiva -> errore doppia prenotazione.
-- Ora, su UPDATE, se date e veicolo non cambiano e la prenotazione era gia'
-- attiva, il controllo non si rifa': il pagamento non crea nuovi conflitti.
-- Riattivare una prenotazione annullata/scaduta resta controllato.
-- Solo CREATE OR REPLACE della funzione: nessun dato toccato.
-- ============================================================
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

      -- 2026-10-05: pagamento/conferma su una prenotazione gia' attiva, senza
      -- cambiare date ne' veicolo, non crea alcun conflitto nuovo.
      IF TG_OP = 'UPDATE'
         AND OLD.status IS NOT NULL
         AND OLD.status NOT IN ('cancelled','annullata','completed','completata','expired')
         AND NEW.pickup_date IS NOT DISTINCT FROM OLD.pickup_date
         AND NEW.dropoff_date IS NOT DISTINCT FROM OLD.dropoff_date
         AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
         AND NEW.vehicle_plate IS NOT DISTINCT FROM OLD.vehicle_plate THEN
        RETURN NEW;
      END IF;

      IF NEW.vehicle_plate IN ('TEST000', 'TEST002') THEN
        RETURN NEW;
      END IF;

      IF NEW.service_type = 'car_wash' THEN
        RETURN NEW;
      END IF;

      IF NEW.service_type = 'uscita_straordinaria' THEN
        RETURN NEW;
      END IF;

      IF NEW.customer_name = 'Lavaggio Rientro' THEN
        RETURN NEW;
      END IF;

      IF COALESCE(NEW.booking_details->>'is_courtesy_block', '') = 'true'
         OR COALESCE(NEW.booking_details->>'is_supercar_experience_block', '') = 'true' THEN
        RETURN NEW;
      END IF;

      IF COALESCE(NEW.booking_details->>'allow_double_booking', '') = 'true' THEN
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
