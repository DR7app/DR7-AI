-- Find CHECK constraints on bookings table
SELECT
    con.conname AS constraint_name,
    pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
INNER JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'bookings'
    AND con.contype = 'c'; -- 'c' = CHECK constraint

-- Find all functions that might be checking vehicle conflicts
SELECT 
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND (
        p.proname ILIKE '%booking%'
        OR p.proname ILIKE '%vehicle%'
        OR p.proname ILIKE '%conflict%'
        OR p.proname ILIKE '%check%'
    )
ORDER BY p.proname;
