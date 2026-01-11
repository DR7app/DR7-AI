-- Check all automatic car wash triggers currently deployed
SELECT 
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'bookings'
  AND (trigger_name LIKE '%carwash%' OR trigger_name LIKE '%auto%')
ORDER BY trigger_name;
