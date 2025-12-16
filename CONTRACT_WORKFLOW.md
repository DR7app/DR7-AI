# Contract Generation & Yousign Workflow

## New Step-by-Step Process

### Step 1: Generate Contract
Click **"Genera Contratto"** button in Prenotazioni tab

**What happens:**
1. ✅ Contract PDF is generated
2. ✅ PDF automatically opens in new tab for review
3. ✅ Success message appears with next steps
4. ✅ "Invia a Yousign" button becomes visible

### Step 2: Review Contract
Review the PDF that opened automatically

**Check:**
- ✅ Customer data (nome, cognome, email, telefono, indirizzo, etc.)
- ✅ Driver license details
- ✅ Vehicle details (marca, modello, targa)
- ✅ Rental dates and times
- ✅ Insurance, deposit, km limits

### Step 3: Send to Yousign
Click **"Invia a Yousign"** button

**What happens:**
1. ✅ Contract uploaded to Yousign
2. ✅ Signature request created
3. ✅ **Yousign automatically sends email** to customer
4. ✅ Status changes to "In Attesa di Firma" (⏳)

### Step 4: Customer Signs
Customer receives email from Yousign

**Customer actions:**
1. Opens email from Yousign
2. Clicks signature link
3. Reviews contract
4. Signs electronically

### Step 5: Contract Completed
After customer signs:

1. ✅ Yousign webhook notifies system
2. ✅ Status changes to "Firmato" (🖊️)
3. ✅ Signed PDF available for download
4. ✅ "Contratto Firmato" button appears

---

## Success Messages

### After Generate Contract:
```
✅ Contratto generato con successo!

📄 Il PDF si è aperto in una nuova scheda per la revisione.

✍️ Dopo aver verificato il contratto, clicca "Invia a Yousign" per inviarlo al cliente.
```

### After Send to Yousign:
```
✅ Richiesta di firma inviata con successo! 📩
```

---

## Button States

| State | Button | Color | Action |
|-------|--------|-------|--------|
| No contract | **Genera Contratto** | Blue | Generates PDF |
| Contract generated | **Invia a Yousign** | Pink | Sends to Yousign |
| Waiting for signature | **⏳ In Attesa di Firma** | Yellow | Disabled |
| Signed | **🖊️ Contratto Firmato** | Purple | Opens signed PDF |

---

## Going Live with Yousign

### Update Environment Variables in Netlify:

1. Go to Netlify Dashboard → Site Settings → Environment Variables
2. Update these 2 variables:

```
YOUSIGN_API_KEY = ys_prod_XXXXXXXXXXXXXXXX
YOUSIGN_API_BASE_URL = https://api.yousign.app/v3
```

3. Save and redeploy

### Set Up Webhook in Yousign:

1. Log into Yousign production dashboard
2. Go to Settings → Webhooks
3. Add webhook URL:
   ```
   https://dr7empire.netlify.app/.netlify/functions/yousign-webhook
   ```
4. Enable events:
   - ✅ `signature_request.done`
   - ✅ `signature_request.declined`
   - ✅ `signature_request.expired`

---

**Last Updated**: December 16, 2025
