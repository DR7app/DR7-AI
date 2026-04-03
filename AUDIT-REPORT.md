# AUDIT TECNICO — DR7 Empire Admin
**Data:** 2026-04-01 | **Modalita:** READ-ONLY | **Branch:** claude/investigate-missing-invoice-rxgbq
**Stack:** React 19 + TypeScript 5.9 + Vite 7 + Supabase + Netlify Functions + Tailwind CSS 4

---

## RIEPILOGO

| Severita | Conteggio |
|----------|-----------|
| CRITICAL | 12 |
| HIGH | 18 |
| MEDIUM | 22 |
| LOW | 15 |
| **TOTALE** | **67** |

**Rischio #1:** I webhook Nexi (pagamenti) NON verificano la firma HMAC. Chiunque puo inviare un POST fake per confermare pagamenti fraudolenti.

---

## CRITICAL (12)

| # | Area | File | Problema |
|---|------|------|----------|
| C1 | Backend | `nexi-payment-callback.ts` | Nessuna verifica firma HMAC sui webhook Nexi. Endpoint pubblico, fraud risk reale. |
| C2 | Backend | `list-bookings.ts`, `save-customer.ts` | Nessuna autenticazione. Espongono tutti i dati booking/customer senza token check. |
| C3 | Backend | `delete-booking.ts` | Nessun controllo autorizzazione. Qualsiasi utente puo cancellare qualsiasi prenotazione. |
| C4 | Database | `create_review_screenshot_submissions.sql` | RLS `WITH CHECK (true)` — utenti anonimi possono inserire/leggere/modificare tutto. |
| C5 | Database | `create_system_messages.sql` | RLS completamente aperta su tutte le operazioni. Template WhatsApp esposti. |
| C6 | Database | `create_cauzioni_system.sql` | Mismatch tipi finanziari: cauzioni usa NUMERIC(10,2) euro, wallet/nexi usa INTEGER centesimi. |
| C7 | Payment | `ReservationsTab.tsx`, `CarWashBookingsTab.tsx` | `payment_link_expires_at` non settato all'INSERT. Se Nexi fallisce, booking zombie per sempre. |
| C8 | Payment | `vehicleAvailability.ts:320` | Check disponibilita usa stato legacy (`'pending'`). Bookings moderni usano `'unpaid'` — rischio double-booking. |
| C9 | Payment | `CarWashBookingsTab.tsx:855` | Booking lavaggio senza campi payment_link. Se nexi-pay-by-link fallisce, slot bloccato per sempre. |
| C10 | Backend | `nexi-pay-by-link.ts:52` | Nessun limite massimo importo. Solo check `amount <= 0`. |
| C11 | Frontend | `AdminDashboard.tsx:148` | Stale closure in useEffect con eslint-disable. Event listener cattura stato obsoleto. |
| C12 | Test | Intero progetto | Copertura test ~2%. Zero test per: 113 Netlify functions, tutti i componenti, contexts, hooks. |

---

## HIGH (18)

| # | Area | File | Problema |
|---|------|------|----------|
| H1 | Backend | `nexi-payment-callback.ts:113` | Idempotency debole — webhook duplicato con diverso operation ID bypassa il guard. |
| H2 | Backend | `nexi-payment-callback.ts:381` | Race condition webhook/cron — tra SELECT e UPDATE lo stato puo cambiare. |
| H3 | Backend | `nexi-payment-callback.ts:243` | Promise rejection non gestita su chiamate WhatsApp/fattura. Crash silenzioso. |
| H4 | Backend | Tutte le funzioni | Nessun timeout su fetch() esterne (Anthropic, Nexi, Green API). |
| H5 | Backend | `nexi-pay-by-link.ts:6` | Env var con `!` non-null assertion invece di validazione. 502 se mancante. |
| H6 | Backend | `cancel-unpaid-nexi-bookings.ts:92` | Atomicita mancante — aggiorna booking, poi transaction, poi WhatsApp separatamente. |
| H7 | Backend | `signature-init.ts:80` | `.single()` senza error handling. Se 0 o 2+ risultati, esecuzione continua con null. |
| H8 | Database | Multiple tabelle | RLS `authenticated` senza ruoli — staff e admin hanno stesse permission ovunque. |
| H9 | Database | `20260325_fix_cauzioni_schema.sql` | Mix DATE e TIMESTAMPTZ nella stessa tabella. Problemi DST. |
| H10 | Database | `.env.example` | API keys in plaintext, nessun secret manager. |
| H11 | Payment | `CalendarTab.tsx:213` | Logica visibilita duplicata manualmente invece di usare `isCalendarVisible()`. |
| H12 | Frontend | `VehicleAlarmContext.tsx:727` | exhaustive-deps disabilitato su polling 60s. Dati stale possibili. |
| H13 | Frontend | `VehicleAlarmContext.tsx:74` | localStorage senza error recovery. Se quota esaurita, allarmi rotti. |
| H14 | Frontend | `CalendarTab.tsx:63` | Subscription Supabase senza cleanup. Memory leak. |
| H15 | Frontend | `CustomerWalletTab.tsx:128` | Race condition token auth — token puo scadere tra getSession e fetch. |
| H16 | Config | `_headers` | CSP con `'unsafe-inline'` per style-src. Indebolisce difesa XSS. |
| H17 | Config | `src/pages/admin/components/` | 51 file backup/debug (.bak, .debug, .color1-12). Da eliminare. |
| H18 | Config | Progetto | Nessun vitest.config.ts — nessuna soglia copertura configurata. |

---

## MEDIUM (22)

| # | Problema sintetico |
|---|-------------------|
| M1 | Double link generation possibile — nessun check per link esistente |
| M2 | Nessun campo `service_type` su prenotazioni noleggio |
| M3 | Legacy expiry query manca `'pending_payment'` nel filtro status |
| M4 | Transaction nexi non sincronizzata con booking se update fallisce |
| M5 | TTL payment link (1h) hardcoded in 4+ posti |
| M6 | Booking orfani non recuperabili se `payment_link_expires_at = NULL` |
| M7 | Gap fino a 5 min tra scadenza link e update status del cron |
| M8 | Nessuna schema validation su input JSON.parse (validate-discount-code) |
| M9 | Risposta webhook contiene dati Nexi con PII/carte |
| M10 | N+1 query nel loop del cron job (ogni booking = 3+ query) |
| M11 | Importo referral senza max bound, rischio precision error |
| M12 | `Math.random()` per correlation ID invece di `crypto.randomUUID()` |
| M13 | `Map()` globale in whatsapp-ai-webhook — memory leak tra request |
| M14 | Header duplicati in netlify.toml E _headers file |
| M15 | Nessun source map in produzione |
| M16 | `skipLibCheck: true` in tsconfig |
| M17 | Nessun `engines` in package.json |
| M18 | 337 console.log in produzione |
| M19 | 324+ import con `../../../` — nessun path alias |
| M20 | `Record<string, any>` su metadata, addons, diff in types.ts |
| M21 | Body overflow style non pulito su unmount sidebar |
| M22 | RLS cauzioni `SET NULL ON DELETE` senza trigger void |

---

## LOW (15)

| # | Problema sintetico |
|---|-------------------|
| L1 | Error response format inconsistente tra endpoint |
| L2 | Nessun rate limiting su endpoint pagamento |
| L3 | Supabase URL hardcoded in 2 funzioni |
| L4 | CORS senza Access-Control-Allow-Credentials |
| L5 | Missing rollback su migration merge customer |
| L6 | TypeScript types non validati contro schema DB |
| L7 | ReservationsTab.tsx = 6.225 righe (monolite) |
| L8 | Audio error handler vuoto in VehicleAlarmContext |
| L9 | cachedAdmin senza expiry in logAdminAction |
| L10 | version: "0.0.0" in package.json |
| L11 | Fattura test URL hardcoded in .env.example |
| L12 | Nessun bundle analyzer |
| L13 | Due librerie PDF (pdf-lib + pdfjs-dist) |
| L14 | Index key in liste React (3 componenti) |
| L15 | eslint-disable senza spiegazione in AdminDashboard |

---

## INTERVENTI PRIORITARI

### P0 — BLOCCA DEPLOY (fare subito)

1. **Aggiungere verifica firma HMAC** su `nexi-payment-callback.ts` e `nexi-preauth-callback.ts`
2. **Aggiungere autenticazione** su `list-bookings`, `save-customer`, `delete-booking`
3. **Settare `payment_link_expires_at` all'INSERT** (non dopo la chiamata Nexi) con fallback `created_at + 1h`
4. **Fix vehicleAvailability.ts** — usare `isSlotBlocking()` da bookingPaymentService.ts

### P1 — URGENTE (questo sprint)

5. Restringere RLS su cauzioni, system_messages, review_screenshots
6. Normalizzare tipi finanziari (tutto INTEGER centesimi)
7. Eliminare 51 file backup dal repo
8. Creare vitest.config.ts con soglie coverage
9. Test per 5 funzioni Netlify critiche (webhook, pagamenti, auth)
10. Usare `isCalendarVisible()` in CalendarTab

### P2 — PROSSIMO SPRINT

11. Timeout (AbortController) su tutte le fetch() esterne
12. Centralizzare TTL payment link in config
13. Sostituire `process.env.VAR!` con `getRequiredEnv()`
14. Source map in produzione
15. Path alias TypeScript (@/utils, @/components)
16. Sostituire 337 console.log con logger
17. `npm audit` in CI
18. Fix stale closure in AdminDashboard

---

## VERIFICHE ESTERNE (da fare manualmente)

| # | Dove | Cosa controllare |
|---|------|-----------------|
| 1 | Dashboard Nexi XPay | HMAC secret disponibile, webhook URL, certificato SSL |
| 2 | Supabase Dashboard | RLS attive su TUTTE le tabelle, backup automatici |
| 3 | Netlify Dashboard | Env vars corrette, function logs per errori 502 |
| 4 | Green API (WhatsApp) | Rate limit, messaggi in coda, errori delivery |
| 5 | Fattura Elettronica API | URL produzione vs test, API key attiva |
| 6 | Browser (produzione) | Errori MIME residui, chunk load failures |

---

## MODULI NON TESTATI (rischio maggiore)

| Modulo | Rischio |
|--------|---------|
| 113 Netlify Functions | Auth, webhook, pagamenti non validati |
| vehicleAvailability.ts | Overbooking |
| bookingConflictUtils.ts | Conflitti prenotazione |
| calendarLogic.ts | Off-by-one su date |
| timezoneUtils.ts | Errori DST Roma/UTC |
| Tutti i componenti React | Nessun test rendering |
| Tutti i contexts | State management non validato |

---

*Report generato automaticamente. Nessuna modifica al codice effettuata. Tutte le issue classificate come VERIFIED (osservate nel codice) o HYPOTHESIS (dedotte da pattern, richiedono conferma).*
