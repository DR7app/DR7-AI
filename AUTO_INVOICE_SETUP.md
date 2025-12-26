# Automatic Invoice Generation Setup

## Overview
This setup automatically generates and sends invoices to SDI when a booking status changes to "completed".

## How It Works

1. **Booking is marked as completed** (status changes to 'completed')
2. **Supabase Database Webhook** triggers
3. **Netlify function** `auto-invoice-webhook` is called
4. **Function checks** if invoice already exists
5. **If not**, it:
   - Calls `generate-invoice-from-booking` to create invoice
   - Calls `send-invoice-to-sdi` to send to SDI
6. **Invoice is created and sent** automatically!

## Setup Instructions

### Step 1: Enable Supabase Database Webhooks

1. Go to **Supabase Dashboard** → **Database** → **Webhooks**
2. Click **"Create a new hook"**
3. Configure:
   - **Name**: `auto-invoice-on-completion`
   - **Table**: `bookings`
   - **Events**: Check **UPDATE**
   - **Type**: `HTTP Request`
   - **Method**: `POST`
   - **URL**: `https://dr7empire.com/.netlify/functions/auto-invoice-webhook`
   - **HTTP Headers**: 
     ```json
     {
       "Content-Type": "application/json"
     }
     ```
4. Click **"Confirm"**

### Step 2: Test the Webhook

1. Go to **Admin Panel** → **Reservations**
2. Find a booking
3. Change its status to **"completed"**
4. **Check**: Go to **Fatture** tab
5. **Verify**: Invoice was created automatically
6. **Verify**: Invoice status shows "📤 Inviata" (sent to SDI)

## Alternative: Database Trigger (Advanced)

If you prefer a database trigger instead of webhook, run this SQL:

```sql
-- Enable pg_net extension (required for HTTP calls from database)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Then run the migration
-- File: supabase/migrations/add_auto_invoice_trigger.sql
```

**Note**: The webhook approach is simpler and more reliable for this use case.

## Troubleshooting

### Webhook not firing
- Check Supabase webhook logs in Dashboard → Database → Webhooks
- Verify the URL is correct: `https://dr7empire.com/.netlify/functions/auto-invoice-webhook`

### Invoice not created
- Check Netlify function logs
- Verify booking has all required customer data (name, email, etc.)

### Invoice created but not sent to SDI
- Check that environment variables are set in Netlify
- Check Fattura API credentials are correct

## Disabling Auto-Generation

If you want to disable automatic generation:

1. Go to **Supabase Dashboard** → **Database** → **Webhooks**
2. Find `auto-invoice-on-completion`
3. Click **"Disable"** or **"Delete"**

Or keep it enabled and use the manual "🧾 Fattura" button when needed.
