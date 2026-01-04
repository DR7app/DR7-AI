-- Fix RLS policy to allow admins to see ALL customers (including those with user_id = NULL)

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admins can view all customers" ON customers_extended;
DROP POLICY IF EXISTS "Users can view own customer data" ON customers_extended;
DROP POLICY IF EXISTS "Admins can insert customers" ON customers_extended;
DROP POLICY IF EXISTS "Admins can update customers" ON customers_extended;
DROP POLICY IF EXISTS "Admins can delete customers" ON customers_extended;
DROP POLICY IF EXISTS "Admins full access to customers_extended" ON customers_extended;

-- Create new permissive policy for admins (using correct 'admins' table)
CREATE POLICY "Admins full access to customers_extended"
ON customers_extended
FOR ALL
TO authenticated
USING (
  -- Allow if user is admin (check admins table)
  EXISTS (
    SELECT 1 FROM admins
    WHERE admins.user_id = auth.uid()
  )
)
WITH CHECK (
  -- Allow if user is admin
  EXISTS (
    SELECT 1 FROM admins
    WHERE admins.user_id = auth.uid()
  )
);

-- Also allow users to view their own data (if they have user_id set)
CREATE POLICY "Users can view own customer data"
ON customers_extended
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Verify policies
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'customers_extended';
