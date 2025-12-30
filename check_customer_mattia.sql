-- Check if Mattia Ciambotti exists in customers tables

-- Check auth.users
SELECT 'auth.users' as source, id, email, 
       raw_user_meta_data->>'fullName' as full_name,
       raw_user_meta_data->>'phone' as phone,
       created_at
FROM auth.users
WHERE email = 'ciambox92@gmail.com';

-- Check customers table
SELECT 'customers' as source, id, email, full_name, phone, created_at
FROM customers
WHERE email = 'ciambox92@gmail.com' OR id = '4827f0eb-179a-46d1-84e9-7e8fc64fb00a';

-- Check customers_extended table
SELECT 'customers_extended' as source, id, email, 
       COALESCE(nome || ' ' || cognome, ragione_sociale, denominazione) as full_name,
       telefono as phone, created_at
FROM customers_extended
WHERE email = 'ciambox92@gmail.com' OR id = '4827f0eb-179a-46d1-84e9-7e8fc64fb00a';
