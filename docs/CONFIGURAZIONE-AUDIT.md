# Audit Configurazione DR7 Empire

Documento di governance: cosa e' gestibile dal pannello admin e cosa richiede un deploy.
Tutti i percorsi sono assoluti, riferiti alle due repo:

- **Admin**: `/Users/opheliegiraud/DR7-empire-admin-temp/`
- **Sito**: `/Users/opheliegiraud/antigravity-dr7web/DR7-empire/`

Le tabelle Supabase chiave sono:

- `centralina_pro_config` (riga singola `id='main'`, JSONB) -> letta in tempo reale dal sito e dall'admin tramite il convertitore `convertProConfig.ts`. E' la fonte di verita' per: categorie veicoli, fasce A/B, assicurazioni, KM e sforo, cauzioni, servizi, prezzo dinamico, preventivi, penali, danni.
- `system_messages` -> tutti i template WhatsApp (tabella `MessaggiSistemaProTab`).
- `car_wash_services` -> catalogo Prime Wash.
- `vehicles` -> flotta.
- `config_audit_log` -> storico delle modifiche a centralina.

---

## 1. Funzioni gia' configurabili da pannello

Per ciascuna sezione: tab admin, tabella/colonna Supabase, e cosa l'operatore puo' modificare senza developer.

### 1.1 Centralina Pro (`/admin -> Revenue -> Centralina Pro`)

File: `src/pages/admin/components/CentralinaProTab.tsx` (4626 righe)
Tabella: `centralina_pro_config` (riga `id='main'`, colonna JSONB `config`)

Otto sezioni interne (definite alle righe 49-58 dello stesso file):

| Sezione | Cosa si modifica | Chiave JSONB |
|--------|----------------|-------------|
| Categorie & Fascia | Categorie veicolo (id+label) e Fascia A/B (eta', anni patente) | `categories`, `fasce` |
| Assicurazioni | Opzioni RCA/Kasko per categoria e fascia, prezzo giornaliero, deposito obbligatorio, franchigia | `insurance` |
| Km & Sforo | KM inclusi per giorno per categoria, prezzo extra/km, sforo per categoria/veicolo, KM illimitati per fascia | `km` |
| Cauzioni | Opzioni cauzione per fascia x residenza (residente/non residente), label, importo, sovrapprezzo giornaliero | `deposits` |
| Servizi | Experience services (lista libera con prezzo, unita' di misura, fascia), DR7 Flex, lavaggio interno, delivery prezzo/km, secondo guidatore, pickup locations (aeroporti) | `servizi` |
| Prezzo Dinamico | Base/min/max prices per veicolo (override su `vehicles.id`), tariffe giornaliere, mode `unica`/`per_residenza` | `prezzoDinamico` |
| Preventivi | Maggiorazione %, scadenza default ore | `preventivi` |
| Danni & Penali | Listino danni e penali per categoria | `penali`, `danni` |

Il salvataggio entra in `centralina_pro_config.config` come singolo JSONB; il sito lo legge via `netlify/functions/calculate-dynamic-price.ts` e tramite l'hook `useCentralinaProOverlay`. Le modifiche si propagano in real-time grazie alla subscription in `src/hooks/useRentalConfig.ts:62-85` e identica subscription nell'overlay sito.

### 1.2 Messaggi di Sistema Pro (`/admin -> Messaggi Pro`)

File: `src/pages/admin/components/MessaggiSistemaProTab.tsx`
Tabella: `system_messages` (colonne: `message_key`, `label`, `message_body`, `is_enabled`, `include_header`, `is_automatic`, `trigger_event`, `trigger_offset_hours`, `send_hour`, `target_category`, `target_status`)

Template gia' previsti dal sistema (vedi `MessaggiSistemaProTab.tsx:63-165`):

- Wrapper header/footer (avvolge tutti i messaggi)
- Conferma noleggio / lavaggio / meccanica / pagamento / contratto firmato / preventivo
- Modifica noleggio / lavaggio / meccanica
- Email addebito (corpo + oggetto)
- Promemoria pickup / dropoff / check-in / check-out / firma / pagamento / appuntamento
- Richieste cliente: pagamento, firma, OTP, IBAN, documenti
- Notifiche admin: nuova prenotazione, nuovo preventivo, contratto firmato, pagamento ricevuto, annullamento, carta bloccata
- Documenti: contratto, fattura, penale, ricevuta
- Annullamenti: cliente, rimborso iniziato, rimborso completato
- Marketing: recensione, compleanno, referral, rinnovo membership, bonus wallet

Per ognuno l'operatore modifica corpo, attiva/disattiva, decide se aggiungere header, e (per quelli automatici) trigger e offset orari.

L'invio finale e' centralizzato in `netlify/functions/send-whatsapp-notification.ts`: se la chiave/label non risolve a una riga in `system_messages` il messaggio viene **scartato** (riga 52, 220) — non c'e' fallback hardcoded.

### 1.3 Catalogo Prime Wash (`/admin -> Catalogo Lavaggio`)

File: `src/pages/admin/components/CarWashCatalogTab.tsx`
Tabella: `car_wash_services` (CRUD pieno) + `centralina_pro_config.config.servizi.prime_flex.price`

L'operatore aggiunge/modifica/disattiva servizi e cambia il prezzo Prime Flex (riga 322-339). Il sito li legge via `netlify/functions/get-car-wash-services.ts`.

### 1.4 Veicoli (`/admin -> Veicoli`)

File: `src/pages/admin/components/VehiclesTab.tsx`
Tabella: `vehicles` (CRUD su `id`, `display_name`, `plate`, `category`, `status`, `image`, ecc.). Le categorie selezionabili sono **dinamiche**, lette da `centralina_pro_config.categories` in real-time (cfr. memoria `vehicle_categories_source_of_truth.md`).

### 1.5 Tab amministrative gia' funzionanti

Lista tab presenti in `AdminDashboard.tsx` (righe 635-707) con tabella DB associata:

| Tab | Tabella / Storage |
|-----|------------------|
| Reservations | `bookings` (CRUD + filtri) |
| Customers | `customers_extended` |
| Customer Wallet | `wallet_transactions`, `customer_wallet_balances` |
| Site Users | `auth.users` |
| Calendar / Daily Calendar | `bookings` (visualizzazione) |
| CarWash Bookings/Calendar | `bookings` (service_type='car_wash') |
| Mechanical Booking/Calendar | `bookings` (service_type='mechanical') |
| Fattura / Invoices | `invoices`, `invoice_items` |
| Cauzioni | `deposits` |
| Contratto | `contracts` |
| Birthdays | `customers_extended.data_nascita` |
| Reviews / Review Management | `reviews`, `review_settings` |
| Campagna Marketing | `marketing_campaigns`, `campaign_recipients` |
| Fleet Management | `vehicles`, `vehicle_unavailability_events` |
| Nexi | `nexi_orders`, `nexi_operations` |
| Scadenze | `vehicle_scadenze` (configurazione tipi in `src/pages/admin/components/scadenze/scadenzeConfig.ts` — **HARDCODED**) |
| Reports / Report Lavaggio / Report Clienti / Report Traffic / Report Penali Danni | letture aggregate, nessuna config diretta |
| Codice Sconto | `discount_codes` |
| Gestione Danni / Multe | `damages`, `multas` |
| Cargos | `cargos`, `cargos_recipients` |
| Trustera | API esterna Trustera360 |
| EMTN | `emtn_events`, `emtn_documents` |
| Operatori | `admins` (gestione ruoli da Superadmin) |
| Promo Incassi | `promo_incassi_runs` |
| Maxi Promo Gap | `maxi_promo_gap_runs` |
| Verifica Documenti | `document_verification_requests` |
| Fornitori | `fornitori`, `incoming_invoices` |
| Centralina Pro | `centralina_pro_config` (vedi 1.1) |
| Messaggi Pro | `system_messages` (vedi 1.2) |
| Lottery Tickets | `lottery_tickets` |
| Birthdays | `customers_extended` |
| Aviation Quotes | `aviation_quotes` |
| Referral Program | `referral_codes`, `referral_redemptions` |
| Bulk Import | upload CSV verso `customers_extended` / `vehicles` |

### 1.6 Recensioni — canali di invio

`netlify/functions/review-settings.ts:67-69` esposta come tabella `review_settings`. Operatore puo' impostare `rental_auto_channel` e `wash_auto_channel` su `EMAIL_ONLY | WHATSAPP_ONLY | EMAIL_AND_WHATSAPP`.

### 1.7 OTP & limitazioni

`GestioneOtpTab.tsx` con tabella `otp_codes`. Modal `LimitationOverrideModal` per richieste OTP a recipient condiviso `valesaja91@icloud.com` (vedi `limitation_override_otp_pattern.md`).

---

## 2. Funzioni hardcoded nel codice

Tutto cio' che oggi richiede un deploy per essere modificato. Suddiviso per natura.

### 2.1 Logiche di business e date

| Cosa | Dove (file:riga) | Impatto |
|-----|------------------|---------|
| Buffer 75 min admin | `src/utils/vehicleAvailability.ts:19` (`const BUFFER_MINUTES = 75`) | Ogni cambio richiede deploy. Disallineato col sito (90 min) |
| Buffer 90 min admin (fallback) | `src/pages/admin/components/ReservationsTab.tsx:4107` | Doppio buffer hardcoded nello stesso codice |
| Buffer 75 min duplicato | `src/pages/admin/components/ReservationsTab.tsx:1528` (`75 * 60 * 1000`) | Tre punti diversi che rappresentano lo stesso valore |
| Calcolo giorni noleggio (contratto/fattura) | `netlify/functions/generate-contract.ts:364, 369, 868`; `netlify/functions/generate-invoice-from-booking.ts` | Formula `Math.ceil((dropoff-pickup)/24h)` non modificabile da pannello |
| KM auto (fallback "100/giorno") | `netlify/functions/generate-contract.ts:370-371` (tabella `{1:100,2:180,3:240,4:280,5:300}` + 60/giorno) | Duplica la tabella di Centralina Pro nel codice |
| KM auto "50/giorno" | `netlify/functions/generate-contract.ts:365-366` | Logica fissa nel generatore contratto |
| Sforo default `1.80` | `src/utils/configOverlay.ts:169` (`defaultSforo: '1.80'`) | Override solo se Centralina Pro lo specifica esplicitamente |
| IVA 22% | `netlify/functions/generate-invoice-from-booking.ts:425, 440` (`vatDivisor = 1.22`) | Aliquota IVA non parametrizzabile |

### 2.2 Orari di servizio

| Cosa | Dove | Impatto |
|-----|------|---------|
| Pickup Mon-Fri 10:30-12:30 / 16:30-18:30 | `components/ui/CarBookingWizard.tsx:1108-1109` (sito) | Lo slot generator e' nel codice cliente |
| Pickup Sab 10:30-16:30 | `components/ui/CarBookingWizard.tsx:1111` | Slot sabato hardcoded |
| Return Mon-Fri 9-11 / 15-17 | `components/ui/CarBookingWizard.tsx:1148-1149` | Slot ritorno hardcoded |
| Default pickup time `'10:30'` | `components/ui/CarBookingWizard.tsx:181, 270, 1631, 3098, 5629` | Default sparso in 5+ punti |
| Lavaggio Sat 9-17 / weekday 9-13+15-19 | `src/pages/admin/components/CarWashBookingsTab.tsx:83-119` | Orari lavaggio hardcoded admin |
| Preventivi office hours | `src/pages/admin/components/PreventiviTab.tsx:27-44` (commento + logica) | Slot preventivi fissi |
| Limite riconsegna aeroporto sabato 11:00 | `components/ui/CarBookingWizard.tsx:2342-2344` | Eccezione hardcoded |

### 2.3 Sito — `constants.ts` (651 righe)

File: `/Users/opheliegiraud/antigravity-dr7web/DR7-empire/constants.ts`. E' il **collo di bottiglia principale**. Contiene:

| Cosa | Riga | Impatto |
|-----|------|---------|
| Lista veicoli "Supercar" (id, nome, prezzo, specs, immagini) | 31-147 (`newCarsRawData`) | Aggiungere/togliere una supercar = deploy |
| Lista veicoli "Urban" | 162-211 (`urbanCarsRawData`) | Idem |
| Lista veicoli "Corporate Fleet" | 212-236 (`corporateFleetRawData`) | Idem |
| Tasso EUR->USD | 160 (`EUR_TO_USD_RATE = 1.1`) | Cambio fisso |
| `RENTAL_CATEGORIES` (cars/urban/yachts/jets/membership/credit-wallet/...) usato in `HomePage`, `App`, `Header`, `JetSearchResultsPage` | 349-429 | Le tessere della home page sono hardcoded |
| `MEMBERSHIP_TIERS` con prezzo `4.90/mese` e `39/anno` e features 7-righe IT/EN | 432-463 | DR7 Club: prezzo, lista benefits e cashback in codice |
| `PICKUP_LOCATIONS` / `RETURN_LOCATIONS` | 466-474 | Solo "DR7 Cagliari" + "domicilio" |
| `DR7_OFFICE_ADDRESS = 'Viale Marconi 229...'` | 476 | Indirizzo ufficio in costante |
| `AUTO_INSURANCE` (KASKO automatico, 5 voci coverage) | 479-490 | Testo polizza fisso |
| `INSURANCE_DEDUCTIBLES` (URBAN/UTILITARIA/SUPERCAR con franchigie 2000/5000/30%) | 493-497 | Doppione di centralina (probabile drift) |
| `DEPOSIT_RULES` (LOYAL/FULL/CARD_YOUNG/CASH_PREPAID con cifre 1000-4999-2000) | 499-516 | Doppione di Centralina Pro `deposits` |
| `AGE_BUCKETS` `[18,21,23,25,30]` | 525-531 | Filtri eta' |
| `YACHT_PICKUP_MARINAS` (Cagliari, Porto Cervo) | 535-538 | Marine hardcoded |
| `AIRPORTS` (CAG, OLB, AHO, FCO, LIN, NCE, LBG, LTN, IBZ) | 540-550 | Lista aeroporti fissa |
| `HELI_DEPARTURE_POINTS` / `HELI_ARRIVAL_POINTS` | 552-562 | Eliporti |
| `CRYPTO_ADDRESSES` (BTC/ETH/USDT) | 564-568 | **Indirizzi wallet crypto in codice** (sospetto: placeholder, da verificare) |
| `RENTAL_EXTRAS` (young_driver_fee, additional_driver con €10/giorno) | 570-587 | Extras hardcoded; convivono con `experience_services` di Centralina Pro |
| `INSURANCE_OPTIONS_BY_TIER` (TIER_1/TIER_2 con prezzi 119/89/149/189/289) | 595-607 | Listino assicurazioni nel codice. Il booking wizard usa `configOverlay` (live), ma il codice resta come fallback |
| `TIER_PRICING` (unlimitedKmPerDay 289/189, lavaggio 9.90) | 609-612 | Idem |
| `NO_DEPOSIT_SURCHARGE_PER_DAY = 49` | 614 | Sovrapprezzo "no cauzione" |
| `TIER_DEPOSIT_OPTIONS` con `vehicle_deposit/credit_card/cash_prepaid/no_deposit` | 616-628 | Opzioni cauzione. Doppione di `centralina_pro_config.deposits` |
| `DELIVERY_PRICE_PER_KM = 3` | 630 | €/km consegna |
| `EXPERIENCE_SERVICES` (8 servizi con prezzi 7.90-200) | 632-641 | Doppione di `centralina_pro_config.servizi.experience` |
| `PAYMENT_MODES` (full/deposit) con label + descrizione | 647 in poi | Modalita' di pagamento e copy in codice |

### 2.4 Sito — Catalogo lavaggio statico

File: `pages/CarWashServicesPage.tsx`

| Cosa | Riga | Impatto |
|-----|------|---------|
| `URBAN_SERVICES` (8 servizi 14.90-119) | 52-137 | Catalogo Prime Urban hardcoded |
| `MAXI_SERVICES` (8 servizi 19.90+) | 140 in poi | Catalogo Prime Maxi hardcoded |
| `EXTRA_CARE_SERVICES`, `EXPERIENCE_SERVICES` | sotto | Add-on hardcoded |

La pagina chiama anche `/.netlify/functions/get-car-wash-services` (riga 579) ma ha hardcoded fallback. Quindi: anche se l'admin modifica `car_wash_services`, la versione mostrata dipende dalla coerenza tra DB e fallback codice.

### 2.5 Sito — Pagine "vetrina" interamente hardcoded

| Pagina | File | Stato |
|--------|------|------|
| Home | `pages/HomePage.tsx` (hero slides, video, claim) | Tutto in codice. Hero slides 35-60, claim/copy in JSX |
| FAQ | `pages/FAQPage.tsx` | 4 Q&A in inglese, completamente hardcoded |
| Cancellation Policy | `pages/CancellationPolicyPage.tsx` | Soglia "5 giorni" + "10%/90%" hardcoded (74-90) |
| Terms of Service | `pages/TermsOfServicePage.tsx` | Testi legali in JSX |
| Privacy / Cookie Policy | `PrivacyPolicyPage.tsx` / `CookiePolicyPage.tsx` | Testi legali in JSX |
| Membership | `pages/MembershipPage.tsx` | Lettura prezzi da `MEMBERSHIP_TIERS` (codice) |
| Investitori | `pages/InvestitoriPage.tsx` | Pitch deck completo in codice |
| Franchising | `pages/FranchisingPage.tsx` | Idem |
| Press | `pages/PressPage.tsx` | Articoli stampa in array statici |
| About | `pages/AboutPage.tsx` | Storia azienda in JSX |
| Careers | `pages/CareersPage.tsx` | Job listings in JSX |
| Token | `pages/TokenPage.tsx` | Token economy text |

### 2.6 Email transactional hardcoded

File: `netlify/functions/send-booking-confirmation.ts` (sito) — l'intero corpo HTML dell'email di conferma e' in template literal **dentro** la funzione (righe 88-119 per car wash, 149+ per noleggio). Stesso schema in tutti i `send-*.ts`. Modificare un orario, un wording, un colore = deploy.

Funzioni con email hardcoded da auditare (admin + sito):

- `send-booking-confirmation.ts` (sito)
- `send-aviation-quote-notification.ts` (sito)
- `send-contract-email.ts` (admin)
- `send-gift-voucher.ts` (admin)
- `send-invoice-to-sdi.ts` — testi email SDI
- `send-lottery-postponement.ts` (admin)
- `send-manual-ticket-pdf.ts` (admin)
- `send-review-request.ts` (admin)
- `send-birthday-messages.ts` (admin)

Per WhatsApp invece il routing va sempre via `system_messages` (`send-whatsapp-notification.ts:52, 220` — hard-skip se template assente). Quindi WhatsApp e' gia' configurabile, EMAIL no.

### 2.7 Status/payment_status enum

| Cosa | Dove |
|-----|-----|
| Status booking `'pending' \| 'confirmed' \| 'active' \| 'completed' \| 'cancelled' \| 'expired' \| 'completata' \| 'annullata'` | `src/types.ts:109`; usato in 487 occorrenze sotto `src/` (vedi grep) |
| Payment status `'paid' \| 'completed' \| 'succeeded'` (tre valori "pagato") | sparso in `bookingPaymentService.ts`, ReservationsTab, BookingDetailsPanel, ecc. |

Aggiungere uno status (es. "preautorizzato", "in_attesa_firma") = audit di tutti i 487 punti.

### 2.8 Categorie veicolo `'exotic' | 'urban' | 'aziendali'` come literal type

| Dove | Riga |
|-----|-----|
| `src/types.ts:43` | `category: 'exotic' \| 'urban' \| 'aziendali' \| null` |
| `src/utils/vehicleClassification.ts:60-160+` | mapping modello -> categoria con array hardcoded di model name (centinaia di marche/modelli) |

Le categorie sono dichiarate dinamiche in `centralina_pro_config.categories` ma il **TypeScript type** rimane l'unione fissa, e l'auto-classificazione targa->categoria e' tabellare nel codice.

### 2.9 Scadenze veicolo

File: `src/pages/admin/components/scadenze/scadenzeConfig.ts` — la lista dei tipi scadenza (revisione, bollo, assicurazione, tagliando, ecc.) con offset di alert e severita' e' hardcoded.

### 2.10 Mappature label-only fragili

Memo: `status_promotion_templates_by_label.md` e `preventivi_template_keys.md`. I template `Promozione a ELITE`, `Promozione a MEMBER`, `Ingresso DR7 Club`, `Preventivo WhatsApp`, `Preventivo senza sconto` sono caricati per **label** in `system_messages`. Non c'e' fallback: rinominare la label in pannello rompe l'invio. La logica e' in `src/pages/admin/components/CustomersTab.tsx:1378, 1457`.

### 2.11 RBAC tab admin

`src/pages/admin/AdminDashboard.tsx:140-141`:

```
const financialTabs: TabType[] = ['fattura', 'nexi', 'unpaid', 'cauzioni']
const adminOnlyTabs: TabType[] = ['reports', 'report-noleggio', 'report-lavaggio', 'report-clienti', 'report-traffic']
```

Le restrizioni di accesso ai tab non sono nel DB: per dare a un operatore l'accesso a "fattura" senza renderlo superadmin, serve modificare il codice.

### 2.12 Indirizzi crypto wallet, env URLs

- `constants.ts:564-568` indirizzi BTC/ETH/USDT.
- `netlify/functions/nexi-payment-callback.ts:272, 440, 545, 688` — fallback URL admin `'https://admin.dr7empire.com'` hardcoded come default.

---

## 3. Modifiche che richiedono deploy

Categorizzate.

### 3.1 Categorie

- Aggiungere/rimuovere una categoria veicolo (oltre alle gia' note `exotic`, `urban`, `aziendali`, `furgone`): impatta `src/types.ts:43`, `vehicleClassification.ts`, `convertProConfig.ts:56-60` (mapping `PRO_TO_DB_CATEGORY`), e tutti i 487 controlli di status.
- Tipi di scadenza (revisione/bollo/...): `src/pages/admin/components/scadenze/scadenzeConfig.ts`.
- Tipi di servizio (`car_wash` / `mechanical` / `rental`): mancano completamente come tabella; sono enum sparsi.

### 3.2 Prezzi

- Listino assicurazioni di **fallback** sito (`constants.ts:595`): non bloccante perche' override Centralina Pro, ma se Centralina manca o si rompe il convertProConfig il sito mostra prezzi del 2024.
- DR7 Club €4.90/mese e €39/anno: `constants.ts:436-438`.
- Sovrapprezzo "no cauzione" €49/giorno: `constants.ts:614`. Configurabile in Centralina Pro `no_cauzione_surcharge`, ma il sito ha la copia in costante.
- DELIVERY_PRICE_PER_KM €3: `constants.ts:630`.
- Default sforo €1.80/km: `src/utils/configOverlay.ts:169`.
- Listino Prime Wash di **fallback** sito: `pages/CarWashServicesPage.tsx:52-137+` (URBAN_SERVICES, MAXI_SERVICES, EXTRA_CARE_SERVICES, EXPERIENCE_SERVICES).
- Lista veicoli sito (Supercar/Urban/Corporate) con `dailyPrice`: `constants.ts:31-236`. Anche se `useVehicles` legge dal DB su `RentalPage`, la `HomePage` renderizza `RENTAL_CATEGORIES` (statico) per le tessere.
- Aliquota IVA 22%: vari `netlify/functions/generate-*.ts`.

### 3.3 Copy / contenuti sito

- Tutto cio' elencato in 2.5 (Home, FAQ, Cancellation, Terms, Privacy, Cookie, Membership copy, Investitori, Franchising, Press, About, Careers, Token).
- Hero video / hero slides: `pages/HomePage.tsx:35-60` (URL `/main.mp4`, `/video2.mp4`...).
- Email transactional (sito + admin): tutte le `netlify/functions/send-*.ts` con template literal HTML.
- Indirizzo ufficio: `constants.ts:476`.
- Marine, aeroporti, eliporti: `constants.ts:535-562`.

### 3.4 Automazioni

- Buffer minuti (75 admin, 90 sito): `vehicleAvailability.ts:19`, `ReservationsTab.tsx:1528, 4107`, e analoghi sul sito.
- Orari pickup/return (Lun-Sab 10:30-12:30/16:30-18:30 etc.): `CarBookingWizard.tsx`.
- Orari lavaggio: `CarWashBookingsTab.tsx`.
- Cancellation policy soglia 5 giorni / 10% / 90%: `CancellationPolicyPage.tsx` + logica wallet credit (cancellation_policy.md indica memoria — verificare se e' applicata server-side, probabilmente sparsa nei callback Nexi).
- Logica giorni noleggio (`Math.ceil(diff/24h)`): `generate-contract.ts`, `generate-invoice-from-booking.ts`. Memoria critica indica di NON cambiarla, ma resta che e' in codice.
- Logica giorni report mensile (calendar-day + 14:00 cutoff): `src/utils/monthlyBookingMath.ts`.
- Cron jobs (promo-incassi, maxi-promo-gap, fornitori, club interest, dr7 privilege, rental extension supercar): tutti con schedule definito in `netlify.toml` o in JS, parametri (soglie, importi) hardcoded nelle funzioni cron.

### 3.5 Regole di business

- Fascia age/license (21/26/3/5): definita come default in `src/hooks/rentalConfigDefaults.ts:14-18` ma sovrascrivibile da `centralina_pro_config.fasce`. **OK pannello**.
- Loyalty threshold "3 noleggi": `constants.ts:515` (`LOYAL_CUSTOMER_THRESHOLD: 3`).
- Cashback rates (3%/6%): vedi memoria `cashback_rules.md`. Dichiarato in codice in punti multipli (`netlify/functions/award-fidelity-points.ts`, ...). Verificare path esatto.
- Status promotion thresholds (Member/Elite annual spend): vedi memoria `tier_annual_spend_rule.md`. Logica cron `dr7-privilege-cron.ts`.
- Status enum, payment status enum: 487 occorrenze (vedi 2.7).
- RBAC tab admin: `AdminDashboard.tsx:140-141`.

---

## 4. Modifiche possibili senza deploy

Categorizzate.

### 4.1 Categorie

- Categorie veicolo (label + id): Centralina Pro -> Categorie & Fascia. Real-time.
- Fascia A / Fascia B: range eta', anni patente. Centralina Pro.

### 4.2 Prezzi

- Tutto il `centralina_pro_config`:
  - base_prices / min_prices / max_prices per veicolo.
  - Tariffe giornaliere (tabella per residenza).
  - Assicurazioni (per categoria x fascia), prezzo, deposito obbligatorio, franchigia.
  - Cauzioni per fascia x residenza.
  - KM inclusi e sforo per categoria; override per veicolo.
  - DR7 Flex (prezzo, refund %, tier restriction).
  - Lavaggio interno fee.
  - Delivery price/km.
  - Secondo guidatore.
  - Pickup locations (aeroporti) con km.
  - Experience services (lista libera con prezzo/unita').
  - Maggiorazione preventivi e scadenza default.
  - Listino Penali e Danni.
- Catalogo Prime Wash (`car_wash_services`): prezzo, durata, attivo/disattivo, descrizione.
- Prime Flex add-on price: Centralina Pro `servizi.prime_flex.price`.

### 4.3 Messaggi (WhatsApp)

- Tutti i template in `system_messages` via tab "Messaggi Pro": header/footer wrapper, conferme, modifiche, promemoria, richieste, notifiche admin, marketing, documenti, annullamenti.
- Trigger automatici (offset ore, ora invio, target categoria/status) per i template `is_automatic = true`.

### 4.4 Automazioni gestibili dal pannello

- Canali invio recensioni (email/whatsapp/entrambi) via `review_settings`.
- Campagne marketing schedulate (`marketing_campaigns`) — invio via cron `process-scheduled-campaigns-cron.ts`.
- Promo incassi, maxi promo gap: parametri base modificabili nei rispettivi tab (verifica per tab).
- Veicoli e relativa flotta (CRUD), targhe, stato, categoria.
- Clienti, wallet, codici sconto, referral.
- Documenti cliente, scadenze (esecuzione; i tipi sono hardcoded — vedi 2.9).
- Operatori e ruoli (admin/superadmin) tramite tab "Operatori".

### 4.5 Contenuti sito

Niente. Il sito e' interamente "compile-time" per copy, hero, FAQ, policy. **Vedi sezione 5.5**.

---

## 5. Piano per rendere autonome le 5 aree

Per ogni area: gap, schema proposto, UI proposta, complessita' (S/M/L), priorita'.

### 5.1 Categorie

**Gap.** Le categorie veicolo sono *quasi* configurabili (Centralina Pro le gestisce). Restano hardcoded:
- Il TS type literal `'exotic' | 'urban' | 'aziendali'` (`src/types.ts:43`).
- L'auto-classificazione targa->categoria (`vehicleClassification.ts`).
- I 487 controlli di status booking (`'pending' | 'confirmed' | ...`).
- I tipi di servizio (`'car_wash' | 'mechanical' | rental`).
- I tipi di scadenza veicolo (`scadenzeConfig.ts`).
- Il mapping `PRO_TO_DB_CATEGORY` (`convertProConfig.ts:56`).

**Schema proposto.** Estensione di `centralina_pro_config`:

```jsonc
// centralina_pro_config.config
{
  "categories": [...esistente...],
  "booking_statuses": [
    { "id": "pending", "label": "In attesa", "is_terminal": false, "blocks_availability": true },
    { "id": "confirmed", "label": "Confermata", ... },
    ...
  ],
  "payment_statuses": [
    { "id": "paid", "label": "Pagato", "counts_as_paid": true },
    { "id": "succeeded", "label": "Pagato (Nexi)", "counts_as_paid": true },
    ...
  ],
  "service_types": [
    { "id": "rental", "label": "Noleggio" },
    { "id": "car_wash", "label": "Lavaggio" },
    { "id": "mechanical", "label": "Meccanica" }
  ],
  "scadenze_types": [
    { "id": "revisione", "label": "Revisione", "alert_days_before": 30, "severity": "high" },
    ...
  ]
}
```

Nuova tabella `vehicle_classification_rules` (pattern -> category) per sostituire `vehicleClassification.ts`.

**UI.** Nuova sub-section "Tassonomie" dentro Centralina Pro:
- Tab "Stati Prenotazione": tabella editabile (id, label, terminale, blocca disponibilita').
- Tab "Stati Pagamento": tabella editabile (id, label, conta come pagato).
- Tab "Tipi Scadenza": tabella editabile (id, label, alert offset, severita').

**Complessita'.** L (richiede refactor di 487 occorrenze; serve un util `isPaidStatus(s)` / `isCancelledStatus(s)` centralizzato che legge dalla config, e una migrazione progressiva).

**Priorita'.** Media. Solo le scadenze sono frequentemente toccate; gli status enum cambiano raramente.

### 5.2 Messaggi (e-mail in primis)

**Gap.** WhatsApp e' gia' completamente parametrizzato. **Email transactional sono hardcoded** in 8+ Netlify function (vedi 2.6). La governance e' incoerente.

**Schema proposto.** Estendere `system_messages` con campo `channel` (`whatsapp | email | sms | pec`) e nuovi campi opzionali:

```sql
ALTER TABLE system_messages
  ADD COLUMN channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN email_subject text,
  ADD COLUMN email_html_body text,
  ADD COLUMN email_text_body text,
  ADD COLUMN email_attachments_template jsonb;
```

Sostituire le funzioni `send-booking-confirmation.ts`, `send-contract-email.ts`, ecc. con un singolo `send-email-template.ts` che risolve template per `(channel='email', message_key)` e applica `{var}` substitution.

**UI.** La tab "Messaggi Pro" diventa multicanale: ogni template ha un selettore canale (WA/Email/SMS) e i campi corretti (subject + body HTML per email). Un editor WYSIWYG semplice (Tiptap o textarea + preview) e' sufficiente per partire.

Aggiungere nelle stesse categorie gia' esistenti (Conferma/Promemoria/Documenti/...) le varianti email accanto a quelle WA.

**Complessita'.** M (lo schema e' lineare; il refactor delle Netlify function richiede attenzione perche' alcuni email hanno PDF allegati e dati strutturati — es. fattura, contratto).

**Priorita'.** Alta. Gli email hardcoded sono il caso piu' comune di "richiesta di deploy per cambiare una virgola".

### 5.3 Automazioni

**Gap.** Buffer minuti, orari pickup/return, orari lavaggio, soglie cancellation policy, cron schedule e parametri cron sono in codice. Il tab "Messaggi Pro" gia' espone `trigger_event`, `trigger_offset_hours`, `send_hour` per i template, quindi il pattern esiste — ma manca per le regole di business strutturali.

**Schema proposto.** Nuova sezione `automations` in `centralina_pro_config.config`:

```jsonc
{
  "automations": {
    "buffer_minutes": {
      "rental_after": 75,
      "rental_before": 0,
      "car_wash_after": 30,
      "mechanical_after": 60
    },
    "rental_hours": {
      "pickup": {
        "mon_fri": [["10:30","12:30"], ["16:30","18:30"]],
        "sat": [["10:30","16:30"]],
        "sun": []
      },
      "return": {
        "mon_fri": [["09:00","11:00"], ["15:00","17:00"]],
        "sat": [["09:00","11:00"]],
        "sun": []
      },
      "slot_minutes": 15
    },
    "wash_hours": {
      "mon_fri": [["09:00","13:00"], ["15:00","19:00"]],
      "sat": [["09:00","13:00"], ["14:00","18:00"]],
      "sun": []
    },
    "cancellation_policy": {
      "threshold_days": 5,
      "fee_percent": 10,
      "wallet_credit_percent": 90,
      "no_show_penalty_percent": 100
    },
    "loyalty": {
      "loyal_customer_min_rentals": 3
    },
    "vat_rate": 22,
    "currency_conversion": { "EUR_TO_USD": 1.10 }
  }
}
```

**UI.** Nuovo tab dentro Centralina Pro "Automazioni & Regole":
- Riquadro "Buffer veicolo" con 4 number input.
- Riquadro "Orari ritiro/riconsegna noleggio" con grid editabile per giorno settimana e finestre.
- Riquadro "Orari lavaggio".
- Riquadro "Cancellation policy" con 4 number input.
- Riquadro "Loyalty / IVA / Cambio".

**Complessita'.** L (i consumatori sono 5+ punti per buffer, decine di punti per slot generation; serve adapter centralizzato `getBufferMinutes(serviceType)`, `getRentalSlots(date, type)` che leggono da config).

**Priorita'.** Alta sui buffer e orari (cambiano per stagione/eventi). Media sul resto.

### 5.4 Prezzi

**Gap.** Centralina Pro copre 80% dei prezzi. Restano:
- Listino assicurazioni di **fallback** in `constants.ts:595` -> il sito ha drift se Centralina Pro non risponde.
- Listino cauzioni di fallback in `constants.ts:616`.
- Listino Prime Wash di fallback in `pages/CarWashServicesPage.tsx`.
- Aliquota IVA 22% sparsa.
- Cashback rates (3%/6%).
- Loyalty threshold (3 noleggi).
- Tasso EUR->USD 1.10.

**Schema proposto.** Spostare tutti i fallback nel solo `centralina_pro_config` (gia' nominato come "single source of truth"). Aggiungere:

```jsonc
{
  "fiscal": { "vat_rate": 22 },
  "loyalty": {
    "min_rentals_for_loyal": 3,
    "cashback_rates": {
      "card_full_payment": 3,
      "card_deposit": 1,
      "extras": 2,
      "wash": 3
    }
  },
  "currency": { "EUR_TO_USD": 1.10, "EUR_TO_USD_AUTO_REFRESH": false }
}
```

Cancellare definitivamente i mapping legacy in `constants.ts:493-628`. Il sito si appoggia gia' a `configOverlay`; basta rimuovere il fallback.

**UI.** Sezione "Fiscale & Loyalty" nel tab Centralina Pro. Quattro/cinque number input.

**Complessita'.** S per VAT + EUR_TO_USD + loyalty threshold. M per pulizia di tutti i fallback in `constants.ts` (richiede testing E2E sul checkout).

**Priorita'.** Alta. La duplicazione costanti vs Centralina Pro e' il principale rischio di "sito mostra un prezzo, contratto ne stampa un altro".

### 5.5 Contenuti sito

**Gap.** Il sito non ha CMS. Tutto il copy (hero, FAQ, policy, about, press, careers, investitori, franchising, token, membership marketing copy, email transactional templates) e' in codice JSX o in template literal.

**Schema proposto.** Nuova tabella Supabase `site_content`:

```sql
CREATE TABLE site_content (
  page_key text NOT NULL,         -- 'home', 'faq', 'cancellation', 'about', ...
  section_key text NOT NULL,      -- 'hero', 'q1', 'block_2', ...
  locale text NOT NULL DEFAULT 'it', -- 'it' | 'en'
  body_markdown text,             -- corpo principale
  body_html text,                 -- override quando serve HTML
  metadata jsonb,                 -- es. { "video_url", "cta_label", "cta_link" }
  is_published boolean DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (page_key, section_key, locale)
);
```

Hero slides come metadata su `(home, hero, it)`:

```json
{
  "slides": [
    { "id": 1, "video_url": "/main.mp4" },
    { "id": 2, "video_url": "/video2.mp4" }
  ],
  "auto_advance_seconds": 8
}
```

Endpoint sito: `netlify/functions/get-site-content.ts?page=faq&locale=it` con cache CDN e revalidate on-demand.

**UI.** Nuovo tab admin "Contenuti Sito" con:
- Albero pagine (Home, FAQ, Cancellation, Terms, Privacy, Cookie, About, Careers, Press, Investitori, Franchising, Token, Membership).
- Per ogni pagina elenco sezioni editabili (markdown).
- Selettore lingua IT/EN.
- Anteprima.
- Tasto "Pubblica" (toggle `is_published`) e storico (audit log gia' esiste come `config_audit_log`).

Migrazione iniziale: script che copia il JSX statico in `site_content` come seed. Le pagine React si refactorano per leggere da hook `useSiteContent('faq')`.

**Complessita'.** L (il refactor pagine richiede 1-2 settimane; il CMS in pannello e' M ma robusto). E-mail templates: vedere 5.2 — riutilizzare `system_messages` con `channel='email'`.

**Priorita'.**
- Alta per FAQ, Cancellation Policy, Membership copy, hero claim (cambiano spesso).
- Media per Terms / Privacy / Cookie (richiesti aggiornamenti normativi 1-2 volte l'anno).
- Bassa per About / Careers / Press / Investitori (poche modifiche).

---

## Sintesi prioritaria

| Priorita' | Area | Azione | Tempo stimato |
|----------|------|--------|---------------|
| 1 | Email | Estendere `system_messages` con `channel='email'` + refactor 8+ Netlify function | 2 settimane (M) |
| 2 | Prezzi residui | Eliminare fallback in `constants.ts:493-641`, centralizzare VAT/EUR_USD/loyalty in Centralina Pro | 1 settimana (S/M) |
| 3 | Automazioni | Aggiungere `automations` (buffer, orari, cancellation policy) a Centralina Pro + tab UI | 2-3 settimane (L) |
| 4 | Contenuti sito | Tabella `site_content` + tab admin + refactor FAQ/Cancellation/Membership/Hero | 3-4 settimane (L) |
| 5 | Tassonomie | Tabelle `booking_statuses`, `payment_statuses`, `scadenze_types` + util centralizzato | 2 settimane (L) |

## Punti aperti / aree non verificate

- L'effettiva applicazione server-side della cancellation policy non e' stata letta riga per riga: la memoria indica `cancellation_policy.md` ma il path esatto nei callback Nexi va confermato.
- I cron `promo-incassi-cron.ts`, `maxi-promo-gap-cron.ts`, `dr7-privilege-cron.ts`, `accrue-club-wallet-interest.ts`, `payout-club-wallet-interest.ts` hanno parametri (importi, soglie, percentuali) che andrebbero ispezionati uno per uno per stabilire quali sono gia' in DB e quali in codice.
- Il flag "Massimo Runchina" / VIP pricing risulta rimosso (memoria `clientPricingRules.ts removed April 2026`), ma file `CONFIGURE_MASSIMO_VIP.sql` esiste ancora nel repo sito — verificare se ha effetti residui.
- L'admin ha 103 file `.tsx` puliti + un'enorme quantita' di backup (`*.bak`, `*.btnfix`, `*.color1`...) che inquinano le ricerche; questa audit li ha esclusi ma andrebbero archiviati.
