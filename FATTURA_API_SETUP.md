# Fattura Elettronica API - Environment Setup

## Step 1: Add Environment Variables to Netlify

Go to your Netlify dashboard and add these environment variables:

1. Navigate to: **Site settings** → **Environment variables**
2. Click **Add a variable**
3. Add the following variables:

```
FATTURA_API_USERNAME = Info@dr7.app
FATTURA_API_PASSWORD = Y3vOh5Ka
FATTURA_API_BASE_URL = https://fattura-elettronica-api.it/ws2.0/test
```

## Step 2: Run Database Migration

Run this SQL in your Supabase SQL Editor:

```bash
# Copy the contents of this file:
supabase/migrations/add_sdi_tracking_fields.sql

# Then paste and run in Supabase Dashboard > SQL Editor
```

Or run via command line:
```bash
cd /Users/opheliegiraud/antigravity-dr7/DR7-empire-admin
supabase db push
```

## Step 3: Deploy to Netlify

After adding the environment variables, redeploy your site:

```bash
git add .
git commit -m "Add Fattura Elettronica API integration"
git push
```

Netlify will automatically redeploy with the new functions.

## Step 4: Test the Integration

1. Go to Admin Panel → Fatture
2. Click "+ Nuova Fattura"
3. Fill in the invoice details:
   - Customer name, address, Codice Fiscale
   - Add line items
   - Click "Salva e Invia a SDI"
4. You should see a success message with the SDI ID
5. The invoice status should show "📤 Inviata"
6. Click "🔄 Stato" to check the current status

## Troubleshooting

### If you get "Failed to send to SDI":
- Check that environment variables are set in Netlify
- Verify your Fattura API credentials are correct
- Check the browser console for error messages

### If status stays "📝 Bozza":
- The automatic sending might have failed
- Check Netlify function logs for errors
- Try clicking "🔄 Stato" to manually check

### To switch to Production:
Change the `FATTURA_API_BASE_URL` environment variable to:
```
https://fattura-elettronica-api.it/ws2.0/prod
```

Then redeploy.
