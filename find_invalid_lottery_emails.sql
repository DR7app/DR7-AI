-- ============================================
-- FIND INVALID EMAIL ADDRESSES IN LOTTERY TICKETS
-- ============================================

-- 1. Find emails that don't match standard email pattern
SELECT 
  ticket_number,
  full_name,
  email,
  purchase_date,
  CASE 
    WHEN email IS NULL THEN '❌ NULL email'
    WHEN email = '' THEN '❌ Empty string'
    WHEN email NOT LIKE '%@%' THEN '❌ Missing @ symbol'
    WHEN email LIKE '% %' THEN '❌ Contains spaces'
    WHEN email NOT LIKE '%@%.%' THEN '❌ Missing domain extension'
    WHEN LENGTH(email) < 5 THEN '❌ Too short'
    ELSE '⚠️ Other validation issue'
  END as issue
FROM commercial_operation_tickets
WHERE email IS NULL 
   OR email = ''
   OR email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
ORDER BY purchase_date DESC;

-- 2. Count how many invalid emails exist
SELECT 
  COUNT(*) as total_invalid_emails,
  COUNT(DISTINCT LOWER(email)) as unique_invalid_emails
FROM commercial_operation_tickets
WHERE email IS NULL 
   OR email = ''
   OR email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';

-- 3. Find emails with common issues
SELECT 
  'Missing @' as issue_type,
  COUNT(*) as count
FROM commercial_operation_tickets
WHERE email IS NOT NULL AND email != '' AND email NOT LIKE '%@%'

UNION ALL

SELECT 
  'Contains spaces' as issue_type,
  COUNT(*) as count
FROM commercial_operation_tickets
WHERE email LIKE '% %'

UNION ALL

SELECT 
  'Missing domain' as issue_type,
  COUNT(*) as count
FROM commercial_operation_tickets
WHERE email IS NOT NULL AND email != '' AND email NOT LIKE '%@%.%'

UNION ALL

SELECT 
  'NULL or empty' as issue_type,
  COUNT(*) as count
FROM commercial_operation_tickets
WHERE email IS NULL OR email = '';

-- 4. List ALL emails for manual review (sorted alphabetically)
SELECT 
  ticket_number,
  full_name,
  email,
  purchase_date,
  CASE 
    WHEN email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN '✅ Valid'
    ELSE '❌ Invalid'
  END as status
FROM commercial_operation_tickets
WHERE email IS NOT NULL AND email != ''
ORDER BY email;
