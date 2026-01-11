-- Verify all automatic car wash triggers are deployed
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'bookings'
  AND (trigger_name LIKE '%carwash%' OR trigger_name LIKE '%lavaggio%')
ORDER BY trigger_name;
