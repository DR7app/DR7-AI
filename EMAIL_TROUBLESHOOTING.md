# Email Sending Troubleshooting Guide

## Common Issues and Solutions

### 1. Missing SMTP Credentials
**Error:** "SMTP credentials not configured"

**Solution:** Add these environment variables in Netlify:
- `GMAIL_USER` or `SMTP_USER` - Your Gmail address
- `GMAIL_PASS` or `SMTP_PASS` - Your Gmail app password (NOT your regular password)

**How to get Gmail App Password:**
1. Go to https://myaccount.google.com/security
2. Enable 2-Factor Authentication if not already enabled
3. Go to "App passwords"
4. Generate a new app password for "Mail"
5. Copy the 16-character password
6. Add it to Netlify environment variables as `GMAIL_PASS`

### 2. Contract PDF Not Available
**Error:** "Contract PDF not available. Please generate it first."

**Solution:** The contract must be generated before sending the email. Make sure:
- The contract generation completed successfully
- The `contract_url` field is populated in the booking record
- OR the `contracts` table has a record with `pdf_url` for this booking

### 3. Failed to Download PDF
**Error:** "Failed to retrieve PDF for attachment"

**Possible Causes:**
- The PDF URL is expired (signed URLs expire after a certain time)
- The PDF file was deleted from Supabase storage
- Network connectivity issues

**Solution:**
- Regenerate the contract to get a fresh URL
- Check Supabase storage to ensure the PDF exists

### 4. Email Sending Failed
**Error:** Various SMTP errors

**Common Causes:**
- Gmail blocking "less secure apps" - Use App Password instead
- Daily sending limit reached (Gmail has limits)
- Recipient email address is invalid
- SMTP port blocked by firewall

**Solution:**
- Verify SMTP credentials are correct
- Use Gmail App Password (not regular password)
- Check recipient email is valid
- Try sending a test email manually

## Checking Netlify Logs

To see detailed error messages:

1. Go to Netlify Dashboard
2. Select your site
3. Click "Functions" in the left sidebar
4. Click on `send-contract-email`
5. View the logs to see detailed error messages

All log messages are prefixed with `[send-contract-email]` for easy filtering.

## Testing SMTP Configuration

You can test your SMTP configuration by checking the Netlify function logs. The function will log:
- `[send-contract-email] SMTP user configured: your-email@gmail.com`

If you don't see this, your SMTP credentials are not configured correctly.
