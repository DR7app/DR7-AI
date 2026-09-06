# PERFORMANCE_REPORT — DR7 AI (platform.dr7ai.com)

Audit del 02/09/2026. Repo `~/DR7-staging` (`DR7app/DR7-AI`), branch `main`.
Misure eseguite sull'istanza **demo** (`dr7-demo-platform.netlify.app`), che ha
lo stesso volume di dati della produzione (2.609 prenotazioni, 2.081 clienti,
6.349 transazioni Nexi), con Postgres letto direttamente in sola lettura.

> **Nota di metodo.** Questo audit NON parte da zero: sessioni precedenti
> (29/08 e 02/09) avevano gia' misurato tutte le 87 pagine e corretto motore
> allarmi, `ClientStatusContext`, Recensioni, `dashboard-kpi`, paginazione DOM
> e miniature immagini. Quanto segue e' cio' che **resta**, piu' i difetti di
> correttezza scoperti strada facendo.

---

## 1. Executive summary

**Il database non e' il collo di bottiglia.** Le query applicative su Postgres
stanno tutte sotto i 100 ms; `bookings` ha 34 indici, `customers_extended` 33.
Non c'e' nessuna query lenta da sistemare e non servono nuovi indici (semmai ce
ne sono di duplicati, vedi §5).

Il costo e' **il peso di cio' che viene spedito al browser** e **la tassa fissa
che ogni pagina paga all'avvio**.

| Misura | Valore |
|---|---|
| Apertura tab a freddo (ricarica completa) | 4,4 – 6,2 s |
| Richieste per apertura a freddo | 59 – 128 |
| Cambio tab a caldo (cache attiva) | 0,5 – 3,5 s |
| `bookings` con `select('*')` | **9,00 MB** di JSON, 1,84 MB compressi |
| `preventivi` con `select('*')` | **3,08 MB** di JSON |
| `contracts` con embed prenotazione | **2,87 MB** sul filo |
| `list-customers?fields=anagrafica` | **1,28 MB** |

**Tre difetti di correttezza gia' attivi oggi** (dati mancanti a schermo, non
lentezza) e **una vulnerabilita' verificata** sono descritti in §2. Vanno prima
della performance.

---

## 2. Da correggere prima di tutto (correttezza e sicurezza)

### 2.1 — Documenti d'identita' serviti senza autenticazione — VERIFICATO
`netlify/functions/get-customer-documents.ts:10-16`

```ts
if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }

    // Require authentication          <-- codice morto: dopo il return
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr
}
```

Il controllo di autenticazione e' **dentro** il ramo che ha gia' fatto
`return`: su una POST non viene mai eseguito. Chiunque conosca un `userId` puo'
ottenere gli URL firmati (24 h) di patenti, carte d'identita' e codici fiscali.
Le due righe vanno spostate fuori dall'`if`.

### 2.2 — Quattro funzioni senza `requireAuth` — VERIFICATO
`monthly-report.ts`, `report-danni.ts`, `report-clienti.ts`,
`trigger-dr7-privilege.ts`: zero occorrenze di `requireAuth`. Otto punti di
chiamata usano `fetch()` nudo invece di `authFetch` proprio per questo.

### 2.3 — Token admin nel bundle del browser — VERIFICATO
`src/pages/admin/components/ReservationsTab.tsx:532` legge
`VITE_ADMIN_UI_TOKEN`. Ogni `VITE_*` finisce nel JavaScript scaricato da
chiunque apra il sito, ed e' l'unica credenziale che `netlify/functions/admin.ts:78`
verifica.

### 2.4 — Righe invisibili per il tetto PostgREST a 1000
PostgREST tronca **silenziosamente** ogni risposta a 1000 righe. Letture senza
`.range()` / `fetchAllRows` su tabelle gia' oltre la soglia:

| Punto | Tabella | Righe reali | Viste | Conseguenza |
|---|---|---|---|---|
| `netlify/functions/nexi-list-orders.ts:27` → `NexiTab.tsx:1170` | `nexi_transactions` | **6.349** | 1.000 | 5.349 transazioni assenti; "Incassato" sbagliato |
| `nexi-list-tokenized-cards.ts:73,110` → `NexiTab.tsx:1015` | `nexi_transactions` | **6.349** | 1.000 | carte dei clienti piu' vecchi mai mostrate |
| `CarWashBookingsTab.tsx:1302` | `bookings` (car_wash) | **1.526** | 1.000 | 526 lavaggi assenti; KPI e rinomina targa incompleti |
| `emtn-clients-with-damages.ts:222` | `customers_extended` | **2.081** | 1.000 | meta' dell'indice CF mancante |

Latenti (sotto le 1000 righe oggi, si romperanno da sole crescendo):
`fatture` 748 (`UnpaidBookingsTab.tsx:449`, `GestioneDanniTab.tsx:169`),
`preventivi` 774 (`PreventiviTab.tsx:1593`), `user_documents` 833
(`get-verification-requests.ts:27`), `contracts` 922
(`generate-contract.ts:690` — qui il rischio e' un **numero di contratto
duplicato**, vedi `contract_number_uniqueness`).

### 2.5 — KPI che perdono le righe con `NULL`
`dashboard-kpi.ts:152,159,210` usano `.neq(...)` / `.not(...)`. In SQL una
colonna `NULL` non soddisfa mai `<>`: le prenotazioni con quel campo vuoto
(admin e wallet) spariscono da tutti i KPI. `monthly-report.ts:354` documenta
gia' la correzione da applicare.

---

## 3. Classifica dei colli di bottiglia (per impatto)

### P0-a — `bookings` letta con `select('*')` da quasi ogni tab
102 colonne × 2.609 righe = **9,00 MB di JSON**. Misurato per colonna:
`booking_details` da solo e' il 35,5%; il resto sono 101 colonne, in gran parte
vuote, che costano comunque il nome della chiave per ogni riga.

Misura diretta delle alternative (3 pagine da 1000, stesse righe):

| Variante | Tempo | Compresso | JSON |
|---|---|---|---|
| `select('*')` — oggi | 1.280 ms | 1,84 MB | **9,00 MB** |
| 24 colonne (con `booking_details`) | 1.240 ms | 1,12 MB | **4,35 MB** (−52%) |
| 23 colonne (senza `booking_details`) | 866 ms | 278 KB | **1,88 MB** (−79%) |

Le 24 colonne che servono davvero all'elenco, ai filtri e alle statistiche sono
elencate in §6. **Nessuna riga viene tolta**: cambia solo il numero di colonne.

### P0-b — `preventivi` letta con `select('*')`
`PreventiviTab.tsx:1593`. 79 colonne, **3,08 MB**. Le tre piu' pesanti sono
blob di traccia che servono solo aprendo un preventivo:
`pricing_trace` 1,18 MB (38%), `extras_detail` 461 KB (15%), `events` 67 KB.
Toglierle dall'elenco vale da sola **−53%** sul peso della tab.

### P0-c — `monthly-report` rilegge tutta la tabella `bookings`, senza filtro data
`monthly-report.ts:376`. Costa 2,0 s ed e' sul percorso critico sia di
Prenotazioni sia di Calendario (preriscaldamento `?type=vehicles`).
`dashboard-kpi.ts:1298-1336` la richiama **cinque volte** via HTTP interno.

### P1 — la tassa fissa di ogni pagina
A freddo ogni tab spara 59–128 richieste, e le stesse ricorrono ovunque:
`system_alarms`, `admins?select=permissions`, `centralina_pro_config`,
`customers_extended?select=id,data_nascita`, `bookings?select=id,vehicle_name,...`.
La riga `admins` dell'utente viene letta **quattro volte** per avvio
(`AdminRoute.tsx:42`, `useAdminRole.ts:88`, `BrandSedeContext.tsx:100`,
`VehicleAlarmContext.tsx:183`).

`centralina_pro_config` (204 KB) viene chiesta due volte per pagina perche' due
punti usano forme di query diverse — `select=config&id=eq.main` e
`select=id,config&id=in.(main)` — quindi due chiavi di cache diverse.

### P1 — `AdminRoute` e' lazy e blocca i figli
`App.tsx:16` + `AdminRoute.tsx:26-70`: il chunk piu' grosso (`AdminDashboard`)
non viene nemmeno richiesto prima di due round-trip di rete.

### P1 — N+1 e cicli sequenziali
- `RilevazioneOrariTab.tsx:430` — `for operatore { for giorno { await rpc } }`:
  620 RPC in fila su una vista mensile.
- `CustomerDocuments.tsx:143-150` e `176-183` — una `createSignedUrl` per
  documento, in serie, duplicata in due funzioni (esiste `createSignedUrls`).
- `get-customer-documents.ts:65,96` — fino a ~500 `createSignedUrl` sequenziali.
- `CargosTab.tsx:1118` — un UPDATE per prenotazione inviata (350 in fila).
- `ReviewManagementTab.tsx:824,903` — invii riga per riga.

### P1 — Realtime che ricarica tutto
`CarWashBookingsTab.tsx:1071` e `FleetList.tsx:69` sottoscrivono l'intera
tabella `bookings` con `event:'*'` e chiamano `loadData()` con
`setLoading(true)` a ogni evento: una modifica qualunque, fatta da chiunque,
svuota la tab e rilegge tutto.

### P2 — Render
`CentralinaProTab.tsx:5002` ~300 input non memoizzati ridisegnati a ogni tasto;
`MessaggiSistemaProTab.tsx:4956` tutti i 59 pannelli template montati insieme;
`DocumentsVerificationTab.tsx` otto scansioni complete dell'array per render,
senza un `useMemo`.

---

## 4. Cosa NON e' un problema (verificato, non ipotizzato)

- **Postgres.** Nessuna query applicativa sopra i 100 ms in
  `pg_stat_statements`. Le voci lente in cima sono gli script di
  popolamento della demo, non traffico dell'app.
- **Gli indici.** `bookings` ne ha 34, `customers_extended` 33, comprese le
  GIN trigram per la ricerca. **Non aggiungere indici**: il problema non e' li'.
- **Il code splitting.** 60 tab gia' in `lazyWithRetry`; `recharts`, `leaflet`,
  `pdfjs` e `jszip` non sono nel chunk iniziale. L'unica eccezione e'
  `framer-motion`, trascinato dentro da `LateReturnAlarm` (`App.tsx:10`).
- **Le intestazioni di cache Netlify.** `netlify.toml` e' corretto:
  `index.html` mai in cache, `/assets/*` immutable per un anno.
- **La regione.** Netlify e Supabase sono entrambi in Europa.

**Gia' provato e scartato** (da `velocita_gestionale_tassa_fissa`, non
riproporre senza rimisurare): spostare il preriscaldamento su
`requestIdleCallback` — l'LCP peggiorava da 1,7 a 4,6 s su Clienti.

---

## 5. Database — indici duplicati

Nessun indice da aggiungere. Ce ne sono invece di sovrapposti, che costano
spazio e rallentano ogni INSERT/UPDATE:

| Tabella | Coppie identiche |
|---|---|
| `bookings` | `idx_bookings_service_type` / `bookings_service_type_idx`; `idx_bookings_user_id` / `bookings_user_id_idx` |
| `contracts` | `idx_contracts_booking_id` / `contracts_booking_id_idx` / `contracts_booking_id_key` (unique) |
| `customers_extended` | `idx_customers_citta` / `idx_customers_extended_citta`; `idx_customers_data_nascita` / `idx_customers_extended_data_nascita`; `idx_customers_metadata` / `idx_customers_extended_metadata`; `idx_customers_extended_email` / `customers_extended_email_idx` |

Su `bookings` gli indici pesano 8,3 MB contro 13 MB di tabella totale.
Rimuovere i doppioni e' sicuro ma va fatto con `DROP INDEX CONCURRENTLY` in una
migration dedicata, dopo conferma.

---

## 6. Piano proposto per il P0-a (colonne di `bookings`)

Colonne effettivamente necessarie a elenco, filtri, ricerca e statistiche
(24 su 102):

```
id, user_id, vehicle_id, vehicle_name, vehicle_plate, vehicle_type,
pickup_date, dropoff_date, price_total, amount_paid, status, payment_status,
payment_method, customer_name, customer_email, customer_phone, booking_details,
booked_at, created_at, service_type, service_name, appointment_date,
appointment_time, contract_url
```

`vehicle_type` e' la piu' facile da dimenticare: non compare mai come
`booking.vehicle_type` dentro `ReservationsTab`, la legge `uscitaBelongsTo`
(`src/utils/uscitaStraordinaria.ts:71`). Senza, le Uscite Straordinarie di
Mare/Aria/Soggiorni collassano su Terra.

**Vincolo assoluto prima di applicarlo.** Oggi il dettaglio **non rilegge dal
database**: `handleEditBooking` (`ReservationsTab.tsx:4067`) copia la riga
dell'elenco dentro `formData` e il salvataggio riscrive da `formData`. Se si
restringe la query senza toccare il dettaglio, **aprire e salvare una
prenotazione azzererebbe su database** consegna, ritiro, cauzione,
assicurazione e note. Inoltre `booking.currency.toUpperCase()`
(`ReservationsTab.tsx:4308`) e' senza `?.` e lancerebbe un TypeError.

Quindi l'ordine e' obbligato:
1. il dettaglio rilegge la riga intera per id (`select('*').eq('id',…).single()`);
2. solo dopo si restringe la query dell'elenco.

Mai il contrario, e mai le due cose nello stesso commit senza test.

---

## 7. Integrita' dei dati — impegno

Nessuna delle correzioni proposte riduce il dataset:
- i conteggi restano `count: 'exact'` sul database, mai `array.length`;
- la ricerca resta server-side sull'intera tabella;
- la disponibilita' continua a leggere tutte le righe pertinenti;
- la paginazione riguarda solo cio' che finisce nel DOM;
- restringere le **colonne** non toglie nessuna **riga**.

Al contrario, §2.4 rimette **dentro** i conteggi 5.349 transazioni Nexi e 526
lavaggi che oggi non ci sono.

---

## 8. Stato

Questo documento e' l'audit. **Nessuna modifica al codice e' stata applicata**:
al momento dell'analisi un'altra sessione stava lavorando sugli stessi file
(`ContrattoTab.tsx`, `CustomersTab.tsx`, `PreventiviTab.tsx`, `dataCache.ts`,
`list-customers.ts`), e `CLAUDE.md` §5 chiede di concordare il piano prima di
un refactor multi-file. Le sezioni Benchmark prima/dopo e Matrice delle
performance verranno riempite man mano che le correzioni vengono applicate.

### Baseline registrata (demo, deploy del 02/09 10:03)

| Tab | Apertura a freddo | Richieste | Nodi DOM |
|---|---|---|---|
| Prenotazioni | 6,2 s | 128 | 2.009 |
| Calendario | 4,6 s | 101 | 2.034 |
| Contratti | 4,4 s | 90 | 1.709 |
| Clienti | 4,4 s | 84 | 1.919 |
| Dashboard KPI | 4,4 s | 59 | 183 |
| Preventivi | 1,6 s | 39 | 161 |
| Lavaggi | 1,4 s | 77 | 197 |

Cambio tab a caldo: Calendario 3,5 s · Contratti 1,8 s · Clienti 1,5 s ·
Preventivi 1,5 s · Veicoli 0,5 s.

### Come rimisurare
```
cd ~/career-ops
node misura-dr7.mjs reservations calendar contratto customers   # a freddo
node misura-clic.mjs "Noleggio Terra>Prenotazioni"              # a caldo
node riepilogo-richieste.mjs reservations                       # richieste ripetute
```
