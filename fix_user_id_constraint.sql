-- Fix the foreign key constraint issue
-- The bookings.user_id field should NOT reference auth.users
-- It should be nullable and store customer IDs from customers_extended

-- Step 1: Drop the problematic foreign key constraint
ALTER TABLE bookings 
DROP CONSTRAINT IF EXISTS bookings_user_id_fkey;

-- Step 2: Verify the constraint is gone
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'bookings'::regclass
  AND conname LIKE '%user_id%';

-- Step 3: Now you can run the link script
-- The user_id field will just be a regular UUID column without foreign key constraint
