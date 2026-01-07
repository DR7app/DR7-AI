-- Check all vehicles and their status
SELECT id, display_name, plate, status, category
FROM vehicles
ORDER BY category, display_name;

-- Count by status
SELECT status, COUNT(*) as count
FROM vehicles
GROUP BY status;
