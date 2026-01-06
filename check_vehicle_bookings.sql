SELECT id, pickup_date, dropoff_date, status, vehicle_plate, customer_name, service_type FROM bookings WHERE vehicle_plate = 'GS684XV' ORDER BY dropoff_date DESC LIMIT 5;
