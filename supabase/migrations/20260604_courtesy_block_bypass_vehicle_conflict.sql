-- 2026-06-04: Auto di Cortesia (Prime Wash) — bypass del conflitto veicolo
-- ----------------------------------------------------------------------------
-- Quando l'admin assegna un'auto di cortesia a un lavaggio, viene inserita una
-- "shadow rental row" (service_type='rental', booking_details.is_courtesy_block
-- = true) che OCCUPA il veicolo in calendario. Se il veicolo scelto è già
-- prenotato nella finestra, il trigger di doppia prenotazione la rifiutava con
-- "CONFLICT_DOUBLE_BOOKING ... already booked in the requested window".
--
-- Regola direzione: il conflitto auto di cortesia è consentito SE approvato via
-- OTP direzionale (lato admin, PRIMA dell'insert). Quindi il trigger deve
-- lasciar passare SOLO le righe di blocco cortesia. Restano comunque conteggiate
-- come occupazione per qualsiasi altra prenotazione futura (il blocco funziona).
--
-- NB: preserva la logica esistente (skip su UPDATE + check_unified_vehicle_
-- availability). Aggiunge solo l'early-return per i blocchi cortesia.

CREATE OR REPLACE FUNCTION public.check_vehicle_availability()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
  DECLARE
    v_check RECORD;
  BEGIN
    -- Le modifiche (UPDATE) non rivalidano: l'admin può spostare le date.
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;

    -- 2026-06-04: i blocchi "auto di cortesia" sono approvati via OTP direzionale
    -- lato admin prima dell'insert: possono essere inseriti anche in conflitto.
    IF NEW.booking_details->>'is_courtesy_block' = 'true' THEN
      RETURN NEW;
    END IF;

    -- Valida solo l'INSERT di prenotazioni noleggio (non lavaggio).
    IF (NEW.service_type IS NULL OR NEW.service_type != 'car_wash') AND
       NEW.vehicle_plate IS NOT NULL AND
       NEW.pickup_date IS NOT NULL AND
       NEW.dropoff_date IS NOT NULL AND
       NEW.status IN ('confirmed', 'pending', 'held') THEN

      SELECT * INTO v_check
      FROM check_unified_vehicle_availability(
        NEW.vehicle_plate,
        NEW.pickup_date,
        NEW.dropoff_date,
        NEW.id
      );

      IF NOT v_check.is_available THEN
        RAISE EXCEPTION '%', v_check.conflict_message;
      END IF;
    END IF;

    RETURN NEW;
  END;
$function$;

-- Trigger invariato: ricreato per sicurezza con lo stesso nome usato in prod.
DROP TRIGGER IF EXISTS check_vehicle_availability_trigger ON bookings;
DROP TRIGGER IF EXISTS validate_vehicle_booking ON bookings;

CREATE TRIGGER check_vehicle_availability_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.check_vehicle_availability();

SELECT 'Courtesy blocks now bypass the vehicle double-booking trigger' AS status;
