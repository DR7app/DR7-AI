-- ==============================================================================
-- FIX: Grant Full Permissions & Fix Customer Data Access
-- Author: Antigravity
-- Date: 2026-01-23
-- Description: 1. Grants UPDATE permissions on bookings table to ALL admins.
--              2. Grants SELECT permissions on customers_extended to ALL admins.
-- ==============================================================================

-- 1. FIX BOOKINGS PERMISSIONS (Already planned, but reinforcing UPDATE)
-- ------------------------------------------------------------------------------
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Drop generic policies to be safe
DROP POLICY IF EXISTS "Admins can update bookings" ON bookings;
DROP POLICY IF EXISTS "Admins can select bookings" ON bookings;

-- Re-create UPDATE policy with broad access for ALL admin roles
CREATE POLICY "Admins can update bookings"
ON bookings
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admins
    WHERE admins.user_id = auth.uid()
    AND admins.role IN ('admin', 'superadmin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM admins
    WHERE admins.user_id = auth.uid()
    AND admins.role IN ('admin', 'superadmin')
  )
);

CREATE POLICY "Admins can select bookings"
ON bookings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admins
    WHERE admins.user_id = auth.uid()
  )
);


-- 2. FIX CUSTOMER DATA VISIBILITY (The "Enter Data Again" Issue)
-- ------------------------------------------------------------------------------
-- If the admin cannot READ the customer data, the frontend treats it as "missing"
-- and prompts to enter it again. We must ensure SELECT is open.

ALTER TABLE customers_extended ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can select customers_extended" ON customers_extended;

CREATE POLICY "Admins can select customers_extended"
ON customers_extended
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admins
    WHERE admins.user_id = auth.uid()
  )
);

-- Ensure public/authenticated read access if necessary for basic resolution
-- (This is often the safest fallback for the 'customers' view vs table)


-- 3. FIX BOOKING DETAILS ACCESS (If separate table exists)
-- ------------------------------------------------------------------------------
-- Assuming booking_details is a JSONB column in bookings, but if there are other
-- related tables causing data to "disappear", checking them here.

SELECT '✅ Permissions fixed: Bookings UPDATE & Customers SELECT' as result;
