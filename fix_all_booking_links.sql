-- AUTOMATIC FIX: Link all bookings to their customers
-- This fixes bookings that were created before the customer linking was properly implemented

-- Step 1: Link bookings by phone number
UPDATE bookings b
SET user_id = c.id, updated_at = NOW()
FROM customers_extended c
WHERE b.user_id IS NULL
  AND b.customer_phone IS NOT NULL
  AND b.customer_phone = c.telefono;

-- Step 2: Link bookings by email (for those not matched by phone)
UPDATE bookings b
SET user_id = c.id, updated_at = NOW()
FROM customers_extended c
WHERE b.user_id IS NULL
  AND b.customer_email IS NOT NULL
  AND LOWER(b.customer_email) = LOWER(c.email);

-- Step 3: Show results
SELECT 
    COUNT(*) FILTER (WHERE user_id IS NOT NULL) as linked_bookings,
    COUNT(*) FILTER (WHERE user_id IS NULL) as unlinked_bookings,
    COUNT(*) as total_bookings
FROM bookings
WHERE status != 'cancelled';

-- Step 4: Show any remaining unlinked bookings that need manual attention
SELECT 
    id,
    customer_name,
    customer_phone,
    customer_email,
    created_at,
    'No matching customer found' as issue
FROM bookings
WHERE user_id IS NULL
  AND status != 'cancelled'
ORDER BY created_at DESC;
