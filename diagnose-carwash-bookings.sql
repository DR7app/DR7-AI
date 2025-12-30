-- ============================================
-- DIAGNOSTIC: Check Car Wash Bookings Visibility
-- ============================================

-- 1. Check if RLS is enabled on bookings table
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'bookings';

-- 2. List all RLS policies on bookings table
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'bookings'
ORDER BY policyname;

-- 3. Count total car wash bookings
SELECT COUNT(*) as total_car_wash_bookings
FROM bookings 
WHERE service_type = 'car_wash';

-- 4. Show sample car wash bookings
SELECT 
    id,
    customer_name,
    customer_email,
    service_name,
    appointment_date,
    appointment_time,
    status,
    payment_status,
    created_at
FROM bookings 
WHERE service_type = 'car_wash'
ORDER BY created_at DESC
LIMIT 5;

-- 5. Check if there are any cancelled car wash bookings
SELECT COUNT(*) as cancelled_car_wash_bookings
FROM bookings 
WHERE service_type = 'car_wash' 
AND status = 'cancelled';

-- 6. Check admin users
SELECT 
    id,
    user_id,
    email,
    role,
    created_at
FROM admins
ORDER BY created_at;

-- 7. Test the exact query used by the admin panel
-- This simulates what the admin panel does
SELECT *
FROM bookings
WHERE service_type = 'car_wash'
AND status != 'cancelled'
ORDER BY appointment_date DESC;

-- ============================================
-- POTENTIAL FIX: If RLS is blocking admin access
-- ============================================

-- Run this ONLY if the above queries show that RLS policies are preventing access:
-- (Uncomment the lines below if needed)

/*
-- Ensure admins can view all car wash bookings
DROP POLICY IF EXISTS "Allow admins to view all" ON bookings;
CREATE POLICY "Allow admins to view all"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')
    )
  );

-- Verify the policy was created
SELECT policyname, cmd, roles, qual 
FROM pg_policies 
WHERE tablename = 'bookings' AND policyname = 'Allow admins to view all';
*/
