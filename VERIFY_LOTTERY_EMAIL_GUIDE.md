# How to Verify Your Lottery Email Campaign

You sent an email to 89 ticket buyers. Here's how to verify it was delivered successfully:

## ✅ Quick Verification Methods

### Method 1: Check Netlify Function Logs (FASTEST - but only 7 days retention)

1. Go to **Netlify Dashboard** → **Functions**
2. Click on **`send-lottery-postponement`**
3. Look at the **Function Log** for your send date/time
4. Search for: `[send-lottery-postponement] ✅ Email sent to:`
5. Count the successful sends - should be **89**

**⚠️ IMPORTANT**: Netlify logs are only kept for **7 days**. If your email was sent more than a week ago, use Method 2.

---

### Method 2: Check Gmail Sent Folder (PRIMARY SOURCE OF TRUTH)

1. Log into the Gmail account configured as `GMAIL_USER` in your environment variables
2. Go to the **Sent** folder
3. Search for emails sent on your campaign date
4. Look for subject line matching your lottery email
5. Count the recipients - should be **89**

**This is the authoritative record** since all emails are sent through Gmail SMTP.

---

### Method 3: Run Database Queries (VERIFICATION)

I've created a file `verify_lottery_email_campaign.sql` with comprehensive queries.

**Run this query in Supabase SQL Editor:**

```sql
-- Count total unique recipients
SELECT COUNT(DISTINCT LOWER(email)) as total_unique_recipients
FROM commercial_operation_tickets
WHERE email IS NOT NULL AND email != '';
```

**Expected result**: Should return **89** (or close to it)

---

## 🔍 Detailed Verification

### See the complete list of who SHOULD have received the email:

```sql
WITH unique_buyers AS (
  SELECT DISTINCT ON (LOWER(email))
    email, 
    full_name
  FROM commercial_operation_tickets
  WHERE email IS NOT NULL AND email != ''
  ORDER BY LOWER(email), purchase_date DESC
)
SELECT 
  ROW_NUMBER() OVER (ORDER BY email) as position,
  email,
  full_name
FROM unique_buyers
ORDER BY email;
```

This gives you the **complete alphabetical list** of all 89 recipients.

---

## ❓ What if the count doesn't match 89?

### Possible reasons:

1. **Deduplication**: Customers who bought multiple tickets only receive ONE email
   - Run query #5 in `verify_lottery_email_campaign.sql` to see who has multiple tickets

2. **Missing emails**: Some tickets might not have email addresses
   - Run query #4 to find tickets without emails

3. **Truncated send**: If the campaign was interrupted
   - Check Netlify logs for errors
   - Compare Gmail Sent folder count vs database count

---

## 🚨 If You Find Missing Recipients

If you discover some people didn't receive the email:

1. **Identify the gaps**: Compare Gmail Sent list vs database query results
2. **Use Targeted Resend**: In the admin panel lottery tab:
   - Click "Manda Email"
   - Select ONLY the missing recipients
   - Send to selected recipients only

**⚠️ DO NOT** resend to everyone - this will cause duplicates!

---

## 📊 Understanding the Numbers

- **Total tickets sold**: May be higher than 89
- **Unique email addresses**: Should be 89
- **Emails actually sent**: Should be 89

The difference between total tickets and unique emails is because:
- Some customers bought multiple tickets
- The system deduplicates by email to avoid spam

---

## 🔧 Files Created for You

1. **`verify_lottery_email_campaign.sql`** - Complete set of verification queries
2. **This guide** - Step-by-step verification instructions

Run the SQL queries in your Supabase SQL Editor to get detailed insights.
