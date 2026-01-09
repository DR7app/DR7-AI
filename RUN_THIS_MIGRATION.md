# 🚨 URGENT: Run This Database Migration

## Problem
The lottery email feature is showing an error because the `lottery_email_templates` table doesn't exist in your production database yet.

## Solution
Run the SQL migration that's already copied to your clipboard!

### Steps:

1. **Open Supabase Dashboard**
   - Go to https://supabase.com/dashboard
   - Select your DR7 Empire project

2. **Open SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Paste and Run**
   - Paste the SQL (already in your clipboard)
   - Click "Run" or press `Cmd+Enter`

4. **Verify**
   - You should see: "Success. No rows returned"
   - The table `lottery_email_templates` is now created
   - A default template has been inserted

5. **Test**
   - Refresh your admin panel
   - Click "Manda Email" in the Lotteria tab
   - The modal should open without errors!

## What This Migration Does

✅ Creates the `lottery_email_templates` table  
✅ Adds an index for faster lookups  
✅ Inserts a default email template  

---

**Note**: If the SQL is not in your clipboard, run this command:
```bash
cat supabase/migrations/create_lottery_email_templates.sql | pbcopy
```
