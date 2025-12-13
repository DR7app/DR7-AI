-- Check RLS policies on bookings table
SELECT *
FROM pg_policies
WHERE tablename = 'bookings';
