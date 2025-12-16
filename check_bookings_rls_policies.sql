-- Find all RLS policies on bookings table
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

-- Check if RLS is enabled
SELECT 
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename = 'bookings';
