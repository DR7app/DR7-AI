-- Debug Marco Gerau's booking and customer linkage
-- This will help us understand why contract generation is failing

-- 1. Find Marco Gerau in customers_extended
SELECT 
  id,
  tipo_cliente,
  nome,
  cognome,
  email,
  telefono,
  codice_fiscale,
  indirizzo,
  citta_residenza,
  created_at
FROM customers_extended
WHERE telefono = '3517083580' OR email = 'marcogarau777@gmail.com';

-- 2. Find all bookings for Marco Gerau
SELECT 
  id,
  customer_name,
  customer_email,
  customer_phone,
  user_id,
  vehicle_name,
  pickup_date,
  dropoff_date,
  status,
  booking_details::text
FROM bookings
WHERE customer_phone = '3517083580' 
  OR customer_email = 'marcogarau777@gmail.com'
ORDER BY created_at DESC;

-- 3. Check if there's a customer ID mismatch
SELECT 
  b.id as booking_id,
  b.customer_name,
  b.user_id as booking_user_id,
  b.booking_details->'customer'->>'id' as customer_id_from_details,
  c.id as actual_customer_id,
  c.nome,
  c.cognome
FROM bookings b
LEFT JOIN customers_extended c ON c.telefono = b.customer_phone OR c.email = b.customer_email
WHERE b.customer_phone = '3517083580' 
  OR b.customer_email = 'marcogarau777@gmail.com'
ORDER BY b.created_at DESC;
