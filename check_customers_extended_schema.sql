-- First, let's see the actual schema of customers_extended
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'customers_extended' 
ORDER BY ordinal_position;
