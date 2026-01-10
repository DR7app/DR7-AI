-- Check if RICCARDO PILIA can be loaded by the admin panel
-- This tests RLS policies on customers_extended

-- 1. Verify the customer exists and is accessible
SELECT 
    id,
    nome,
    cognome,
    email,
    telefono,
    tipo_cliente,
    source,
    created_at
FROM customers_extended
WHERE id = '4eba7599-5cd0-44dc-a93b-ff7b6384baf7';

-- 2. Check if there are any RLS policies blocking access
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
WHERE tablename = 'customers_extended';

-- 3. Test if the customer appears in a simple query (as the admin would see)
SELECT COUNT(*) as total_customers
FROM customers_extended;

-- 4. Check specifically for RICCARDO
SELECT COUNT(*) as riccardo_count
FROM customers_extended
WHERE nome ILIKE '%RICCARDO%' AND cognome ILIKE '%PILIA%';
