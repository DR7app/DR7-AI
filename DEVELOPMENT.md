# Development Setup - Invoice System

## Running the Application

The development workflow has been updated to properly support Netlify functions (required for invoices, contracts, and other backend features).

### Start the Development Server

```bash
npm run dev
```

This now runs `netlify dev` which:
- Starts Vite on port 5173 (internal)
- Proxies everything through port 8888
- Serves Netlify functions at `/.netlify/functions/*`

### Access the Application

**Open:** `http://localhost:8888/admin`

⚠️ **Important:** Use port **8888**, not 5173!

## Testing Invoice Generation

1. Navigate to **Noleggio** (Rentals) tab
2. Find any booking
3. Click the purple **"Fattura"** button
4. Invoice should generate successfully
5. Check **Fatture** tab to see the new invoice

## Troubleshooting

### "Cannot connect" or "Connection refused"

Make sure you're using:
```bash
npm run dev
```

NOT:
```bash
npm run dev:vite  # This won't work for invoices
```

### Functions still return 404

1. Stop the dev server (Ctrl+C)
2. Restart: `npm run dev`
3. Wait for "Server now ready on http://localhost:8888"
4. Access `http://localhost:8888/admin`

### Need to use Vite directly?

If you need to run Vite on port 5173 for some reason:
```bash
npm run dev:vite
```

But note: Functions will be proxied to port 8888, so you'll need `netlify dev` running separately.

## What Changed

- **package.json**: `"dev": "netlify dev"` (was `"vite"`)
- **netlify.toml**: Added `[dev]` section for port configuration
- **vite.config.ts**: Added proxy fallback for function calls
