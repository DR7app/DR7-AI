-- Deep investigation: Find ALL bookings for Mercedes Vito VIP DR7
-- Check by plate, vehicle_id, and name

-- First, get the vehicle ID for Mercedes Vito
SELECT 
    id,
    display_name,
    plate,
    targa,
    status,
    metadata
FROM vehicles
WHERE 
    plate LIKE '%GV059GV%' 
    OR targa LIKE '%GV059GV%'
    OR display_name LIKE '%Vito%';
