-- ============================================
-- LOTTERY EMAIL VERIFICATION QUERIES
-- ============================================
-- Use these queries to verify your last email campaign to 89 ticket buyers

-- 1. COUNT TOTAL UNIQUE RECIPIENTS (Should match your expected 89)
-- This shows how many unique email addresses exist in the lottery tickets
SELECT COUNT(DISTINCT LOWER(email)) as total_unique_recipients
FROM commercial_operation_tickets
WHERE email IS NOT NULL AND email != '';

-- 2. LIST ALL UNIQUE RECIPIENTS (Alphabetically by email)
-- This shows the complete list of who SHOULD have received the email
WITH unique_buyers AS (
  SELECT DISTINCT ON (LOWER(email))
    email, 
    full_name,
    purchase_date
  FROM commercial_operation_tickets
  WHERE email IS NOT NULL AND email != ''
  ORDER BY LOWER(email), purchase_date DESC
)
SELECT 
  ROW_NUMBER() OVER (ORDER BY email) as position,
  email,
  full_name,
  purchase_date
FROM unique_buyers
ORDER BY email;

-- 3. LIST ALL UNIQUE RECIPIENTS (Alphabetically by name)
-- Alternative view sorted by customer name
WITH unique_buyers AS (
  SELECT DISTINCT ON (LOWER(email))
    email, 
    full_name,
    purchase_date
  FROM commercial_operation_tickets
  WHERE email IS NOT NULL AND email != ''
  ORDER BY LOWER(email), purchase_date DESC
)
SELECT 
  ROW_NUMBER() OVER (ORDER BY full_name) as position,
  full_name,
  email,
  purchase_date
FROM unique_buyers
ORDER BY full_name;

-- 4. IDENTIFY TICKETS WITHOUT EMAIL (Won't receive communications)
-- These buyers are missing from your email campaign
SELECT 
  ticket_number, 
  full_name, 
  user_id, 
  amount_paid,
  purchase_date
FROM commercial_operation_tickets
WHERE email IS NULL OR email = '';

-- 5. COUNT TICKETS PER EMAIL (Find customers with multiple tickets)
-- This explains why email count (89) is lower than total tickets
SELECT 
  email,
  full_name,
  COUNT(*) as ticket_count,
  STRING_AGG(ticket_number::text, ', ' ORDER BY ticket_number) as ticket_numbers
FROM commercial_operation_tickets
WHERE email IS NOT NULL AND email != ''
GROUP BY email, full_name
HAVING COUNT(*) > 1
ORDER BY ticket_count DESC, email;

-- ============================================
-- VERIFICATION METHODS
-- ============================================

-- METHOD 1: Check Netlify Function Logs
-- Go to: Netlify Dashboard > Functions > send-lottery-postponement
-- Look for logs with: "[send-lottery-postponement] ✅ Email sent to: [email]"
-- NOTE: Logs only available for 7 days!

-- METHOD 2: Check Gmail Sent Folder
-- The authoritative source is the Gmail account configured in GMAIL_USER
-- Search for emails sent on your campaign date
-- This is the PRIMARY source of truth when Netlify logs expire

-- METHOD 3: Export Gmail Sent List and Compare
-- If you need to verify who was missed:
-- 1. Export the recipient list from Gmail Sent folder
-- 2. Run query #2 above to get the expected list
-- 3. Compare the two lists to find any gaps

-- ============================================
-- TROUBLESHOOTING: If count doesn't match 89
-- ============================================

-- Check for duplicate emails (case-insensitive)
SELECT 
  LOWER(email) as normalized_email,
  COUNT(*) as occurrences,
  STRING_AGG(DISTINCT email, ', ') as variations
FROM commercial_operation_tickets
WHERE email IS NOT NULL AND email != ''
GROUP BY LOWER(email)
HAVING COUNT(*) > 1;

-- Check total tickets vs unique emails
SELECT 
  COUNT(*) as total_tickets,
  COUNT(DISTINCT LOWER(email)) as unique_emails,
  COUNT(*) - COUNT(DISTINCT LOWER(email)) as difference
FROM commercial_operation_tickets
WHERE email IS NOT NULL AND email != '';
