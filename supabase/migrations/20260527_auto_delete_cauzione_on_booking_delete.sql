-- 2026-05-27: Companion to 20260527_auto_delete_cauzione_on_booking_cancel.sql.
-- That migration handles SOFT delete (status → cancelled/annullata). This one
-- handles HARD delete (DELETE FROM bookings).
--
-- WHY: `cauzioni.riferimento_contratto_id` is declared as UUID with no FK
-- constraint to `bookings`, so a hard DELETE leaves orphan cauzioni pointing
-- at a row that no longer exists. The cancel trigger doesn't fire because
-- there's no UPDATE — the row simply disappears.
--
-- Behavior:
--   - Fires AFTER DELETE on bookings for each removed row.
--   - DELETES cauzioni rows linked via riferimento_contratto_id = OLD.id
--     UNLESS the row is in a terminal state we must preserve:
--       * stato = 'Restituita'   (refund already issued)
--       * stato = 'Incassata'    (deposit retained)
--       * data_incasso IS NOT NULL (deposit cashed)
--   - Terminal rows stay (audit trail), but their riferimento_contratto_id
--     becomes a dangling pointer — admin tools already tolerate that.

CREATE OR REPLACE FUNCTION delete_cauzione_on_booking_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM cauzioni
  WHERE riferimento_contratto_id = OLD.id
    AND COALESCE(stato, '') NOT IN ('Restituita', 'Incassata')
    AND data_incasso IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_cauzione_on_booking_delete ON bookings;

CREATE TRIGGER trg_delete_cauzione_on_booking_delete
AFTER DELETE ON bookings
FOR EACH ROW
EXECUTE FUNCTION delete_cauzione_on_booking_delete();

-- One-time cleanup: remove non-terminal cauzioni whose riferimento_contratto_id
-- no longer matches any booking (orphans from past hard-deletes).
DELETE FROM cauzioni c
WHERE c.riferimento_contratto_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = c.riferimento_contratto_id)
  AND COALESCE(c.stato, '') NOT IN ('Restituita', 'Incassata')
  AND c.data_incasso IS NULL;

COMMENT ON FUNCTION delete_cauzione_on_booking_delete() IS
  'Auto-deletes non-terminal cauzioni when a booking is HARD deleted. Companion to delete_cauzione_on_booking_cancel(). Preserves Restituita/Incassata/data_incasso rows. Added 2026-05-27.';
