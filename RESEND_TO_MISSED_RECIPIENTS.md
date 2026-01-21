# How to Resend Email to Missed Recipients (M-Z)

## What Happened

Your email campaign stopped sending at the letter **"L"** alphabetically by email address. This means:
- ✅ **People with emails starting A-L received the email**
- ❌ **People with emails starting M-Z did NOT receive it**

## Step-by-Step Fix

### Step 1: Wait for Deployment (2-3 minutes)
The fix has been deployed. Wait a few minutes for Netlify to rebuild the site.

### Step 2: Identify Who Was Missed

Run this query in **Supabase SQL Editor**:

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
  email,
  full_name
FROM unique_buyers
WHERE LOWER(email) >= 'm'
ORDER BY LOWER(email);
```

This will show you the **exact list of people who were missed**.

### Step 3: Resend to ONLY the Missed Recipients

1. **Refresh your admin panel** (hard refresh: Cmd+Shift+R)
2. Go to **Lottery tab**
3. Click **"Manda Email"**
4. **IMPORTANT**: In the recipient list, **SELECT ONLY** the people from M-Z
   - You can use the search box to filter
   - Or manually check only emails starting with M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z
5. Paste your refund message:

```
Gentile Cliente,

riassumiamo in modo molto semplice per evitare ulteriori equivoci.

1) Il bonifico dei soldi è già in lavorazione  
I dati IBAN che ci ha fornito vengono utilizzati per il rimborso in denaro, che verrà regolarmente accreditato.

2) Il ticket NON sostituisce il bonifico  
Il ticket rimane valido come Gift Card da €30 non cumulabile,utilizzabile solo per  il noleggio come da regolamento,in aggiunta al rimborso che riceverà sul conto.

In breve:
•  i soldi tornano sul conto;
•  il ticket resta una Gift Card utilizzabile per il noleggio;
•  se non desidera usarla, può semplicemente non utilizzarla.

I rimborsi stanno procedendo regolarmente.

Cordiali saluti  
Team DR7
```

6. Add subject: **"Importante: Chiarimento Rimborso Lotteria"**
7. Click **"Invia a X Selezionati"** (where X is the number of M-Z recipients)

### Step 4: Verify

After sending, check your **Gmail Sent folder** to confirm all M-Z recipients received the email.

## Why This Happened

The frontend was trying to load all clients but crashed when it encountered a null/empty email in the database. The fix now:
- Filters out invalid emails before processing
- Prevents the crash that was stopping the send

## Files Created for You

1. **`find_missed_lottery_emails_after_L.sql`** - Query to find who was missed
2. **This guide** - Step-by-step instructions

## ⚠️ CRITICAL: Do NOT Resend to Everyone!

**Only send to M-Z recipients**. If you send to everyone again, people with A-L emails will receive duplicate messages!
