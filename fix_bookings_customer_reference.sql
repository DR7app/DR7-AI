-- FIX: Remove the foreign key constraint from bookings.user_id to users table
-- The user_id field should reference customers_extended, not the auth.users table

-- Step 1: Drop the existing foreign key constraint
ALTER TABLE bookings 
DROP CONSTRAINT IF EXISTS bookings_user_id_fkey;

-- Step 2: Add a new column for customer reference if it doesn't exist
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS customer_id UUID;

-- Step 3: Copy existing user_id values to customer_id for bookings that reference customers_extended
UPDATE bookings
SET customer_id = user_id
WHERE user_id IS NOT NULL;

-- Step 4: Add foreign key constraint to customers_extended
ALTER TABLE bookings
ADD CONSTRAINT bookings_customer_id_fkey 
FOREIGN KEY (customer_id) 
REFERENCES customers_extended(id) 
ON DELETE SET NULL;

-- Step 5: Create an index for performance
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);

-- Step 6: Verify the changes
SELECT 
    COUNT(*) as total_bookings,
    COUNT(customer_id) as bookings_with_customer,
    COUNT(*) - COUNT(customer_id) as bookings_without_customer
FROM bookings
WHERE status != 'cancelled';

-- Step 7: Show sample of linked bookings
SELECT 
    b.id,
    b.customer_name,
    b.customer_id,
    c.nome,
    c.cognome,
    c.telefono
FROM bookings b
LEFT JOIN customers_extended c ON b.customer_id = c.id
WHERE b.status != 'cancelled'
ORDER BY b.created_at DESC
LIMIT 5;
