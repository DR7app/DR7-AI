-- Update Mattia Ciambotti's customer record with correct data from auth.users

UPDATE customers
SET 
  full_name = 'Mattia Ciambotti',
  phone = '3519507775',
  updated_at = NOW()
WHERE id = '4827f0eb-179a-46d1-84e9-7e8fc64fb00a';

-- Verify the update
SELECT id, email, full_name, phone, created_at, updated_at
FROM customers
WHERE id = '4827f0eb-179a-46d1-84e9-7e8fc64fb00a';
