-- ============================================
-- FIND WHO MISSED THE EMAIL (Stopped at "L")
-- ============================================

-- This query shows all unique lottery buyers sorted by email
-- to identify who was missed when the send stopped at letter "L"

WITH unique_buyers AS (
  SELECT DISTINCT ON (LOWER(email))
    email, 
    full_name
  FROM commercial_operation_tickets
  WHERE email IS NOT NULL AND email != ''
  ORDER BY LOWER(email), purchase_date DESC
)
SELECT 
  ROW_NUMBER() OVER (ORDER BY LOWER(email)) as position,
  email,
  full_name,
  SUBSTRING(LOWER(email), 1, 1) as first_letter,
  CASE 
    WHEN LOWER(email) < 'm' THEN '✅ LIKELY RECEIVED (before M)'
    ELSE '❌ LIKELY MISSED (M and after)'
  END as status
FROM unique_buyers
ORDER BY LOWER(email);

-- ============================================
-- COUNT: How many likely received vs missed
-- ============================================

WITH unique_buyers AS (
  SELECT DISTINCT ON (LOWER(email))
    email
  FROM commercial_operation_tickets
  WHERE email IS NOT NULL AND email != ''
  ORDER BY LOWER(email)
)
SELECT 
  COUNT(CASE WHEN LOWER(email) < 'm' THEN 1 END) as likely_received,
  COUNT(CASE WHEN LOWER(email) >= 'm' THEN 1 END) as likely_missed,
  COUNT(*) as total
FROM unique_buyers;

-- ============================================
-- EXTRACT ONLY THE MISSED EMAILS (M-Z)
-- ============================================
-- Use this list for TARGETED RESEND in the admin panel

WITH unique_buyers AS (
  SELECT DISTINCT ON (LOWER(email))
    email, 
    full_name
  FROM commercial_operation_tickets
  WHERE email IS NOT NULL AND email != ''
  ORDER BY LOWER(email), purchase_date DESC
)
SELECT 
  email,
  full_name
FROM unique_buyers
WHERE LOWER(email) >= 'm'
ORDER BY LOWER(email);
