-- Check what data exists in RICCARDO PILIA's booking
SELECT 
  id,
  customer_name,
  customer_email,
  customer_phone,
  booking_details,
  user_id
FROM bookings
WHERE id = '6304f31a-b81b-4c2f-9efa-67b9e35f75c6';

-- Check what's in his customer record
SELECT *
FROM customers_extended
WHERE email = 'r.p.system.srl@gmail.com';
