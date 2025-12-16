-- Delete the conflicting booking that's blocking new reservations

-- First, check what this booking is
SELECT 
    id,
    customer_name,
    vehicle_name,
    vehicle_plate,
    pickup_date,
    dropoff_date,
    status,
    booking_source,
    service_type,
    created_at
FROM bookings
WHERE id = '76152554-7cc7-4769-a005-49fbfcea73b0';

-- If you want to delete it, uncomment this:
-- DELETE FROM contracts WHERE booking_id = '76152554-7cc7-4769-a005-49fbfcea73b0';
-- DELETE FROM bookings WHERE id = '76152554-7cc7-4769-a005-49fbfcea73b0';
