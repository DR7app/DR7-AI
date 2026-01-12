-- Check if amount_paid column exists in bookings table
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings'
  AND column_name = 'amount_paid';

-- Also check all columns to see what we have
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'bookings'
ORDER BY ordinal_position;
