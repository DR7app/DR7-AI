# Quick Setup Checklist for Invoice Generation

## ⚠️ Error: "Failed to generate invoice"

This error means the database migration hasn't been run yet. Follow these steps:

### Step 1: Run Database Migration in Supabase

1. Go to **Supabase Dashboard**: https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor**
4. Copy and paste this SQL:

```sql
-- Add SDI tracking fields to fatture table
ALTER TABLE public.fatture
ADD COLUMN IF NOT EXISTS sdi_status TEXT DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS sdi_id TEXT,
ADD COLUMN IF NOT EXISTS sdi_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sdi_response JSONB,
ADD COLUMN IF NOT EXISTS xml_fattura_pa TEXT,
ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id);

-- Add check constraint
ALTER TABLE public.fatture DROP CONSTRAINT IF EXISTS fatture_sdi_status_check;
ALTER TABLE public.fatture ADD CONSTRAINT fatture_sdi_status_check
CHECK (sdi_status IN ('draft', 'sending', 'sent', 'accepted', 'rejected', 'error'));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_fatture_sdi_status ON public.fatture(sdi_status);
CREATE INDEX IF NOT EXISTS idx_fatture_booking_id ON public.fatture(booking_id);
```

5. Click **"Run"**
6. You should see: "Success. No rows returned"

### Step 2: Verify Environment Variables in Netlify

1. Go to **Netlify Dashboard**: https://app.netlify.com
2. Select your site
3. Go to **Site settings** → **Environment variables**
4. Verify these exist:
   - `SUPABASE_SERVICE_ROLE_KEY` (should already exist)
   - `FATTURA_API_USERNAME` = `Info@dr7.app`
   - `FATTURA_API_PASSWORD` = `Y3vOh5Ka`
   - `FATTURA_API_BASE_URL` = `https://fattura-elettronica-api.it/ws2.0/test`

### Step 3: Test Again

1. Wait for Netlify to finish deploying (~2 minutes)
2. Go to **Admin Panel** → **Reservations**
3. Click **"Genera Fattura"** on any booking
4. Should work now! ✅

---

## Still Getting Errors?

If you still see errors after running the migration:

1. **Check Netlify Function Logs**:
   - Netlify Dashboard → Functions → Logs
   - Look for detailed error message

2. **Common Issues**:
   - **"column does not exist"** → Run the migration SQL above
   - **"permission denied"** → Check `SUPABASE_SERVICE_ROLE_KEY` is set
   - **"booking not found"** → Make sure the booking exists in database

3. **Try the detailed error**:
   - After the latest push, the error message will show more details
   - Share the full error message if you need help
