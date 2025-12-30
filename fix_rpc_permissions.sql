-- FIX: Grant permissions to Admin RPC functions (Fixes 403 Error)
-- The "403 Forbidden" error indicates that the authenticated user
-- does not have permission to execute the update function.

-- 1. Grant execute on the update function to all relevant roles
GRANT EXECUTE ON FUNCTION public.admin_update_booking(uuid, timestamptz, timestamptz, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_booking(uuid, timestamptz, timestamptz, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_booking(uuid, timestamptz, timestamptz, text, text, text) TO postgres;

-- 2. Grant execute on the availability check function (just in case)
GRANT EXECUTE ON FUNCTION public.check_unified_vehicle_availability(text, timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_unified_vehicle_availability(text, timestamptz, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_unified_vehicle_availability(text, timestamptz, timestamptz, uuid) TO postgres;

-- 3. Verify the function ownership (Optional but recommended)
-- Fixed typo from previous version (added space before OWNER)
ALTER FUNCTION public.admin_update_booking OWNER TO postgres;
ALTER FUNCTION public.check_unified_vehicle_availability OWNER TO postgres;

SELECT 'Permissions granted successfully for Admin RPCs' AS status;
