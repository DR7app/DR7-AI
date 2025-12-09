# Email Configuration Update

## Changes Made

Updated `send-contract-email.ts` to use the **exact same SMTP configuration** as the working lottery ticket email function.

### Key Changes:

1. **SMTP Service Configuration:**
   - **Before:** Manual SMTP with `host: "smtp.gmail.com"`, `port: 465`, `secure: true`
   - **After:** `service: 'gmail'` (nodemailer's built-in Gmail service)

2. **Environment Variables:**
   - **Before:** `GMAIL_USER || SMTP_USER` and `GMAIL_PASS || SMTP_PASS`
   - **After:** `GMAIL_USER` and `GMAIL_APP_PASSWORD` (matching lottery function)

3. **Improved Error Messages:**
   - Now shows which specific environment variables are missing
   - Clearer instructions for setting up credentials

## Required Environment Variables in Netlify

You need to set these in your Netlify dashboard:

1. **GMAIL_USER** - Your Gmail address (e.g., `your-email@gmail.com`)
2. **GMAIL_APP_PASSWORD** - Your Gmail App Password (16-character code)

### How to Get Gmail App Password:

1. Go to https://myaccount.google.com/security
2. Enable 2-Factor Authentication (if not already enabled)
3. Search for "App passwords"
4. Generate a new app password for "Mail"
5. Copy the 16-character password
6. Add it to Netlify as `GMAIL_APP_PASSWORD`

## Why This Works

The lottery ticket email function has been successfully sending emails using this exact configuration. By aligning the contract email function to use the same setup, it should work identically.

## Testing

After deploying this change and setting the environment variables:
1. Try generating a contract
2. When prompted to send email, click Yes
3. Check the Netlify function logs for detailed error messages if it fails
4. The logs will now show exactly which credentials are missing
