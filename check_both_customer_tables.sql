-- Check if these customers exist in the OLD customers table
SELECT 
    'Old customers table' as source,
    c.*
FROM customers c
WHERE c.email IN ('andrea.caria@dcrsrls.it', 'desmokelu@gmail.com')
ORDER BY c.email;

-- Check customers_extended
SELECT 
    'customers_extended table' as source,
    ce.*
FROM customers_extended ce
WHERE ce.email IN ('andrea.caria@dcrsrls.it', 'desmokelu@gmail.com')
ORDER BY ce.email;

-- Check what columns exist in customers table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'customers'
ORDER BY ordinal_position;

-- Check what columns exist in customers_extended table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'customers_extended'
ORDER BY ordinal_position;
