-- 2026-05-27: Auto-delete cauzioni when a booking is cancelled, regardless of
-- which code path performs the cancel. Replaces the fragile "every code path
-- must remember to delete the cauzione" pattern.
--
-- HISTORY: this same bug ("cauzione resta attiva su prenotazione annullata")
-- has been fixed 3+ times by patching individual callers (delete-booking.ts,
-- cancel-unpaid-nexi-bookings.ts, CarWashBookingsTab.tsx, MechanicalBookingTab.tsx,
-- manage-customer.ts), and 3+ times it has come back because a new cancel path
-- was added without the cleanup. A DB trigger is the only durable fix — it
-- catches every UPDATE that flips bookings.status to a cancellation value,
-- including direct SQL edits, third-party syncs (Cargos), and future code paths.
--
-- Behavior:
--   - Fires AFTER UPDATE on bookings when status transitions to 'cancelled' /
--     'annullata' (case-insensitive) from any other status.
--   - DELETES cauzioni rows linked via riferimento_contratto_id = NEW.id
--     UNLESS the row is in a terminal state we must preserve:
--       * stato = 'Restituita'   (refund already issued)
--       * stato = 'Incassata'    (deposit retained)
--       * data_incasso IS NOT NULL (deposit cashed)
--   - These terminal rows stay so accounting & legal trail are intact.

CREATE OR REPLACE FUNCTION delete_cauzione_on_booking_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_status TEXT;
  new_status TEXT;
BEGIN
  old_status := LOWER(COALESCE(OLD.status, ''));
  new_status := LOWER(COALESCE(NEW.status, ''));

  -- Only act on transitions INTO cancelled/annullata
  IF new_status NOT IN ('cancelled', 'annullata') THEN
    RETURN NEW;
  END IF;

  IF old_status IN ('cancelled', 'annullata') THEN
    -- Already cancelled, nothing to do
    RETURN NEW;
  END IF;

  -- Delete non-terminal cauzioni linked to this booking
  DELETE FROM cauzioni
  WHERE riferimento_contratto_id = NEW.id
    AND COALESCE(stato, '') NOT IN ('Restituita', 'Incassata')
    AND data_incasso IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_cauzione_on_cancel ON bookings;

CREATE TRIGGER trg_delete_cauzione_on_cancel
AFTER UPDATE OF status ON bookings
FOR EACH ROW
EXECUTE FUNCTION delete_cauzione_on_booking_cancel();

-- One-time cleanup: remove any non-terminal cauzioni still attached to
-- already-cancelled bookings (the historical bug — these are stale rows that
-- show up as "active cauzione on annullata booking" in the admin Cauzioni tab).
DELETE FROM cauzioni c
USING bookings b
WHERE c.riferimento_contratto_id = b.id
  AND LOWER(COALESCE(b.status, '')) IN ('cancelled', 'annullata')
  AND COALESCE(c.stato, '') NOT IN ('Restituita', 'Incassata')
  AND c.data_incasso IS NULL;

COMMENT ON FUNCTION delete_cauzione_on_booking_cancel() IS
  'Auto-deletes non-terminal cauzioni when a booking is cancelled (any code path). Preserves Restituita/Incassata/data_incasso rows. Added 2026-05-27 after the 4th regression of the same bug.';
