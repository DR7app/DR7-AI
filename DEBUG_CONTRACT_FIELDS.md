# Debug: Contract Fields Not Filling

## Problem
Most fields in the generated contract PDF are empty, only these are filled:
- Nome & cognome ✅
- Telefono ✅
- E mail ✅
- Tipo di patente ✅

## Likely Cause
**PDF form field names don't match the code mapping**

## How to Fix

### Step 1: Check PDF Field Names in Adobe Acrobat
1. Open your `master_contract.pdf` in Adobe Acrobat
2. Go to: Prepare Form
3. Click on each empty field
4. Check the "Name" property in the right panel
5. Write down the EXACT field names

### Step 2: Compare with Expected Names

The contract generation function tries to fill these field names:

#### First Driver Fields
```
CodiceFiscale          → Codice Fiscale field
Indirizzo              → Indirizzo + CAP (address part)
CAP                    → Indirizzo + CAP (postal code part)
Citta                  → Città field
Provincia              → Provincia field
DataNascita            → Data di nascita field
LuogoNascita           → Città di nascita field
NumeroPatente          → Numero (license number)
EmessaDa               → Emessa da
DataRilascio           → Data di rilascio
Scadenza               → Scadenza
```

#### Vehicle Fields
```
Marca                  → Marca
Modello                → Modello
Targa                  → Targa
DataInizio             → Data di inizio
OraInizio              → Ora di inizio
SedeRitiro             → Sede di ritiro
DataFine               → Data di fine
OraFine                → Ora di fine
SedeRiconsegna         → Sede di riconsegna
Assicurazione          → Assicurazione
SforoPerKM             → Sforo per KM
Cauzione               → Cauzione
KMTotaliNoleggio       → Km totali noleggio
```

### Step 3: Fix Mismatched Names

**Option A**: Rename PDF fields to match the code (recommended)
- In Adobe Acrobat, rename each field to match the names above

**Option B**: Update the code to match your PDF field names
- Edit `netlify/functions/generate-contract.ts`
- Update the `dataMap` object with your actual PDF field names

## Quick Test

To see which fields ARE working, check the contract generation logs:
1. Go to Netlify Functions logs
2. Find the `generate-contract` function execution
3. Look for: `[generate-contract] Filled X fields.`
4. Check the field names that were successfully filled

## Working Fields (from your screenshot)
These field names ARE correct in your PDF:
- `NomeCognome` ✅
- `Telefono` ✅
- `Email` ✅
- `TipoPatente` ✅

Use the same naming pattern for all other fields!
