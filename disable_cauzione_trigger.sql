-- Temporary fix: Disable the cauzioni trigger to allow payment status updates
-- This will allow you to update payment statuses in the Da Saldare tab
-- Run this in Supabase SQL Editor

DROP TRIGGER IF EXISTS trigger_auto_create_cauzione_from_booking ON bookings;

-- You can re-enable it later after fixing the function with:
-- CREATE TRIGGER trigger_auto_create_cauzione_from_booking
--     AFTER INSERT OR UPDATE ON bookings
--     FOR EACH ROW
--     EXECUTE FUNCTION auto_create_cauzione_from_booking();
