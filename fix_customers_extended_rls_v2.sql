-- Enable RLS
ALTER TABLE customers_extended ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to start fresh
DROP POLICY IF EXISTS "Enable read access for all users" ON customers_extended;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON customers_extended;
DROP POLICY IF EXISTS "Enable update for users based on id" ON customers_extended;
DROP POLICY IF EXISTS "Enable read for authenticated users" ON customers_extended;
DROP POLICY IF EXISTS "Enable insert for all users" ON customers_extended;
DROP POLICY IF EXISTS "Enable update for all users" ON customers_extended;

-- Create simple, permissive policies for authenticated users (admins)

-- 1. READ: Allow authenticated users to read all rows
CREATE POLICY "Allow read for authenticated"
ON customers_extended FOR SELECT
TO authenticated
USING (true);

-- 2. INSERT: Allow authenticated users to insert any row
CREATE POLICY "Allow insert for authenticated"
ON customers_extended FOR INSERT
TO authenticated
WITH CHECK (true);

-- 3. UPDATE: Allow authenticated users to update any row
CREATE POLICY "Allow update for authenticated"
ON customers_extended FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. DELETE: Allow authenticated users to delete any row
CREATE POLICY "Allow delete for authenticated"
ON customers_extended FOR DELETE
TO authenticated
USING (true);

-- Verify policies
SELECT * FROM pg_policies WHERE tablename = 'customers_extended';
