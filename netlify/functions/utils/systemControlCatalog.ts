// ═══════════════════════════════════════════════════════════════════════════
// DR7 A.I SYSTEM CONTROL — cataloghi
//
// Un posto solo per: quali integrazioni esistono, come si traduce un errore
// tecnico in italiano comprensibile, quali azioni il Super Admin puo' lanciare
// da solo e quali endpoint interni sono richiamabili da un ritentativo.
//
// Nessun segreto qui dentro: solo NOMI di variabili d'ambiente, mai valori.
// ═══════════════════════════════════════════════════════════════════════════

export type Severita = 'informativo' | 'basso' | 'medio' | 'alto' | 'critico'

/** 1 = si risolve da solo · 2 = lo risolve il Super Admin · 3 = serve sviluppo */
export type ClasseRisoluzione = 1 | 2 | 3

export interface Integrazione {
  chiave: string
  etichetta: string
  categoria: string
  /** Nomi (non valori) delle variabili d'ambiente che la fanno funzionare. */
  variabili: string[]
  /** Come si prova la connessione: gestito in system-control-integrations.ts */
  test: 'supabase' | 'auth' | 'storage' | 'http' | 'env' | 'segreto' | 'nessuno'
  /** URL usato dal test quando test = 'http'. Mai con credenziali in query. */
  testUrl?: string
  /** Cosa smette di funzionare se cade: serve a spiegare la gravita'. */
  impatto: string
}

export const INTEGRAZIONI: Integrazione[] = [
  { chiave: 'supabase', etichetta: 'Database (Supabase)', categoria: 'infrastruttura',
    variabili: ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], test: 'supabase',
    impatto: 'Senza database il gestionale non legge e non salva nulla.' },
  { chiave: 'auth', etichetta: 'Autenticazione', categoria: 'infrastruttura',
    variabili: ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], test: 'auth',
    impatto: 'Nessuno riesce ad accedere al gestionale o al sito.' },
  { chiave: 'storage', etichetta: 'Archivio file', categoria: 'infrastruttura',
    variabili: ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], test: 'storage',
    impatto: 'Contratti, documenti e immagini non si caricano ne si scaricano.' },
  { chiave: 'nexi', etichetta: 'Pagamenti Nexi', categoria: 'pagamenti',
    variabili: ['NEXI_API_KEY', 'NEXI_MERCHANT_ID'], test: 'env',
    impatto: 'I clienti non possono pagare online e i link di pagamento non partono.' },
  { chiave: 'aruba_sdi', etichetta: 'Fatturazione elettronica (SDI)', categoria: 'fatturazione',
    variabili: ['ARUBA_USERNAME', 'ARUBA_PASSWORD'], test: 'env',
    impatto: 'Le fatture restano in bozza e non arrivano allo SDI.' },
  // La PEC non vive nelle variabili d'ambiente: mittente e server stanno in
  // Centralina Pro, la password in service_secrets.
  { chiave: 'pec', etichetta: 'PEC', categoria: 'comunicazione',
    variabili: [], test: 'segreto',
    impatto: 'Le comunicazioni certificate (multe, diffide) non partono.' },
  { chiave: 'email', etichetta: 'E-mail', categoria: 'comunicazione',
    variabili: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'], test: 'env',
    impatto: 'Conferme, contratti e promemoria via e-mail non arrivano ai clienti.' },
  { chiave: 'green_api', etichetta: 'WhatsApp (Green API)', categoria: 'comunicazione',
    variabili: ['GREEN_API_INSTANCE_ID', 'GREEN_API_TOKEN'], test: 'http',
    impatto: 'Nessun messaggio WhatsApp parte: conferme, promemoria, recensioni.' },
  { chiave: 'trustera', etichetta: 'Firma elettronica (DR7 Trust)', categoria: 'documenti',
    variabili: [], test: 'http',
    impatto: 'I contratti non si possono firmare: il noleggio si blocca alla consegna.' },
  { chiave: 'cargos', etichetta: 'CARGOS', categoria: 'adempimenti',
    variabili: ['CARGOS_USERNAME', 'CARGOS_PASSWORD'], test: 'env',
    impatto: 'Le comunicazioni obbligatorie alle autorita non vengono trasmesse.' },
  { chiave: 'openapi_targhe', etichetta: 'Visure targhe (OpenAPI)', categoria: 'dati',
    variabili: [], test: 'segreto',
    impatto: 'Le visure targa non rispondono: i dati del veicolo vanno inseriti a mano.' },
  { chiave: 'gps', etichetta: 'GPS flotta (SafeFleet)', categoria: 'dati',
    variabili: ['SAFEFLEET_USERNAME', 'SAFEFLEET_PASSWORD'], test: 'env',
    impatto: 'Le posizioni dei veicoli non si aggiornano.' },
  { chiave: 'google_gbp', etichetta: 'Google Business Profile', categoria: 'dati',
    variabili: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'], test: 'env',
    impatto: 'Il Rendimento Google resta fermo ai dati vecchi.' },
  { chiave: 'meteo', etichetta: 'Meteo (Open-Meteo)', categoria: 'dati',
    variabili: [], test: 'http', testUrl: 'https://api.open-meteo.com/v1/forecast?latitude=39.2&longitude=9.1&current=temperature_2m',
    impatto: 'L allerta meteo automatica non parte.' },
  { chiave: 'netlify', etichetta: 'Funzioni e deploy (Netlify)', categoria: 'infrastruttura',
    variabili: [], test: 'nessuno',
    impatto: 'Se le funzioni non girano, tutte le automazioni si fermano.' },
]

export const INTEGRAZIONE_BY_CHIAVE: Record<string, Integrazione> =
  Object.fromEntries(INTEGRAZIONI.map(i => [i.chiave, i]))

// ── Traduzione degli errori tecnici ────────────────────────────────────────
// Prima regola che combacia vince. `test` gira sul messaggio tecnico in
// minuscolo unito allo status HTTP.
export interface RegolaTraduzione {
  test: RegExp
  titolo: string
  causa: string
  severita: Severita
  classe: ClasseRisoluzione
  azioni: string[]
}

export const REGOLE_TRADUZIONE: RegolaTraduzione[] = [
  { test: /\b(401|unauthorized|invalid api key|invalid token|authentication failed|invalid credentials)\b/i,
    titolo: 'Credenziali non valide',
    causa: 'Il servizio ha rifiutato le credenziali: chiave cambiata, scaduta o copiata male.',
    severita: 'alto', classe: 2, azioni: ['testa_connessione', 'aggiorna_credenziali'] },
  { test: /\b(403|forbidden|permission denied|not authorized|insufficient)\b/i,
    titolo: 'Autorizzazione mancante',
    causa: 'L utente o la chiave non ha i permessi per questa operazione.',
    severita: 'alto', classe: 2, azioni: ['testa_connessione', 'ricalcola_permessi'] },
  { test: /\b(429|rate limit|too many requests|quota)\b/i,
    titolo: 'Limite di chiamate raggiunto',
    causa: 'Abbiamo superato il numero di richieste consentite dal servizio.',
    severita: 'medio', classe: 1, azioni: ['riprova_piu_tardi'] },
  { test: /\b(token (is )?expired|expired token|jwt expired|refresh token)\b/i,
    titolo: 'Token scaduto',
    causa: 'Il collegamento con il servizio va rinnovato.',
    severita: 'alto', classe: 2, azioni: ['riconnetti', 'testa_connessione'] },
  { test: /\b(timeout|etimedout|timed out|esockettimedout)\b/i,
    titolo: 'Il servizio non ha risposto in tempo',
    causa: 'Rete lenta o servizio esterno sovraccarico.',
    severita: 'medio', classe: 1, azioni: ['riprova', 'testa_connessione'] },
  { test: /\b(502|503|504|bad gateway|service unavailable|gateway timeout|econnrefused|enotfound|fetch failed|network error)\b/i,
    titolo: 'Servizio momentaneamente non disponibile',
    causa: 'Il servizio esterno e offline o irraggiungibile. Di solito rientra da solo.',
    severita: 'medio', classe: 1, azioni: ['riprova', 'testa_connessione'] },
  { test: /duplicate key|unique constraint|23505/i,
    titolo: 'Dato duplicato rifiutato dal database',
    causa: 'Si e provato a creare due volte la stessa riga. La protezione anti-doppione ha funzionato.',
    severita: 'basso', classe: 3, azioni: ['apri_incidente'] },
  { test: /foreign key|violates foreign key|23503/i,
    titolo: 'Collegamento fra dati mancante',
    causa: 'Si fa riferimento a una riga che non esiste (o e stata eliminata).',
    severita: 'alto', classe: 3, azioni: ['apri_incidente'] },
  { test: /column .* does not exist|relation .* does not exist|schema cache|pgrst\d+/i,
    titolo: 'Struttura del database non allineata',
    causa: 'Il codice cerca una colonna o tabella che non esiste ancora: migrazione non eseguita.',
    severita: 'critico', classe: 3, azioni: ['apri_incidente'] },
  { test: /row-level security|rls|policy/i,
    titolo: 'Blocco di sicurezza sui dati',
    causa: 'Le regole di accesso al database hanno impedito la lettura o la scrittura.',
    severita: 'alto', classe: 3, azioni: ['apri_incidente'] },
  { test: /\b(payment|pagamento|carta|card)\b.*\b(declin|refus|fail|ko)/i,
    titolo: 'Pagamento non riuscito',
    causa: 'La banca o il circuito ha rifiutato l operazione.',
    severita: 'medio', classe: 2, azioni: ['riprova', 'apri_scheda_cliente'] },
  { test: /\b(sdi|fattura|invoice)\b.*\b(scart|reject|error)/i,
    titolo: 'Fattura scartata dallo SDI',
    causa: 'I dati della fattura non passano i controlli dell Agenzia delle Entrate.',
    severita: 'alto', classe: 2, azioni: ['apri_fattura', 'riprova'] },
  { test: /webhook/i,
    titolo: 'Webhook non elaborato',
    causa: 'La notifica in arrivo da un servizio esterno non e stata gestita.',
    severita: 'alto', classe: 1, azioni: ['riprova_webhook'] },
  { test: /\b(smtp|mail|email)\b.*\b(fail|error|refus|reject)/i,
    titolo: 'E-mail non inviata',
    causa: 'Il server di posta ha rifiutato il messaggio o non ha risposto.',
    severita: 'medio', classe: 1, azioni: ['riprova_invio', 'testa_connessione'] },
  { test: /\b(500|internal server error|unhandled|cannot read propert|undefined is not|null is not an object)\b/i,
    titolo: 'Errore interno del gestionale',
    causa: 'Il codice ha incontrato una situazione non prevista.',
    severita: 'alto', classe: 3, azioni: ['apri_incidente'] },
]

export interface Tradotto {
  titolo: string
  causa: string
  severita: Severita
  classe: ClasseRisoluzione
  azioni: string[]
}

/** Traduce un errore tecnico in una spiegazione per l amministratore. */
export function traduciErrore(messaggio: string, status?: number | null): Tradotto {
  const testo = `${status ?? ''} ${messaggio || ''}`.trim()
  for (const r of REGOLE_TRADUZIONE) {
    if (r.test.test(testo)) {
      return { titolo: r.titolo, causa: r.causa, severita: r.severita, classe: r.classe, azioni: [...r.azioni] }
    }
  }
  return {
    titolo: 'Errore non riconosciuto',
    causa: 'Il System Control non ha una spiegazione pronta per questo errore.',
    severita: 'medio', classe: 3, azioni: ['apri_incidente'],
  }
}

// ── Azioni sicure disponibili al Super Admin ───────────────────────────────
export interface AzioneSicura {
  chiave: string
  etichetta: string
  descrizione: string
  /** true = mostra una conferma prima di eseguire */
  conferma: boolean
  /** Cosa tocca: serve alla tab per raggruppare i pulsanti. */
  ambito: 'problema' | 'integrazione' | 'operazione' | 'sistema'
}

export const AZIONI_SICURE: AzioneSicura[] = [
  { chiave: 'riprova',             etichetta: 'Riprova',                 descrizione: 'Riesegue l operazione una volta, con la stessa chiave anti-doppione.', conferma: false, ambito: 'operazione' },
  { chiave: 'riprova_tutte',       etichetta: 'Riprova tutte',           descrizione: 'Rimette in coda tutte le operazioni fallite dello stesso tipo.', conferma: true,  ambito: 'operazione' },
  { chiave: 'riprova_webhook',     etichetta: 'Riprova webhook',         descrizione: 'Rimette il webhook in coda per essere rielaborato.', conferma: false, ambito: 'operazione' },
  { chiave: 'riprova_invio',       etichetta: 'Riprova invio',           descrizione: 'Ritenta l invio del messaggio o dell e-mail.', conferma: false, ambito: 'operazione' },
  { chiave: 'annulla_operazione',  etichetta: 'Annulla operazione',      descrizione: 'Toglie l operazione dalla coda senza eseguirla. Resta nello storico.', conferma: true,  ambito: 'operazione' },
  { chiave: 'testa_connessione',   etichetta: 'Testa connessione',       descrizione: 'Contatta il servizio e riporta se risponde.', conferma: false, ambito: 'integrazione' },
  { chiave: 'riconnetti',          etichetta: 'Riconnetti',              descrizione: 'Rilegge le credenziali, azzera il blocco automatico e riprova.', conferma: false, ambito: 'integrazione' },
  { chiave: 'risincronizza',       etichetta: 'Risincronizza',           descrizione: 'Rimette in coda le operazioni rimaste indietro per questa integrazione.', conferma: true,  ambito: 'integrazione' },
  { chiave: 'rigenera_connessione',etichetta: 'Rigenera connessione',    descrizione: 'Azzera lo stato del collegamento e lo ricostruisce dalle credenziali salvate.', conferma: true,  ambito: 'integrazione' },
  { chiave: 'disabilita_integrazione', etichetta: 'Disattiva temporaneamente', descrizione: 'Ferma le chiamate a questo servizio. Le operazioni restano in coda, non si perdono.', conferma: true, ambito: 'integrazione' },
  { chiave: 'riattiva_integrazione',   etichetta: 'Riattiva',            descrizione: 'Rimette in servizio l integrazione e svuota la coda in sospeso.', conferma: false, ambito: 'integrazione' },
  { chiave: 'aggiorna_credenziali',etichetta: 'Aggiorna credenziali',    descrizione: 'Spiega quali variabili aggiornare. I valori non passano mai da questa pagina.', conferma: false, ambito: 'integrazione' },
  { chiave: 'riavvia_job',         etichetta: 'Riavvia job',             descrizione: 'Rilancia subito un automatismo pianificato.', conferma: true,  ambito: 'sistema' },
  { chiave: 'controllo_adesso',    etichetta: 'Controlla adesso',        descrizione: 'Rifa subito il giro completo della piattaforma: collegamenti, automatismi, errori, coda, database.', conferma: false, ambito: 'sistema' },
  { chiave: 'svuota_cache',        etichetta: 'Svuota cache',            descrizione: 'Forza il ricalcolo dei report messi in cache. Non tocca i dati.', conferma: false, ambito: 'sistema' },
  { chiave: 'ricalcola_stato',     etichetta: 'Ricalcola stato',         descrizione: 'Rifa i conti sullo stato di un elemento partendo dai dati reali.', conferma: false, ambito: 'problema' },
  { chiave: 'ricalcola_permessi',  etichetta: 'Ricalcola permessi',      descrizione: 'Rilegge ruoli e permessi dell operatore.', conferma: false, ambito: 'problema' },
  { chiave: 'sblocca_account',     etichetta: 'Sblocca account',         descrizione: 'Toglie il blocco tentativi di accesso a un operatore o cliente.', conferma: true,  ambito: 'problema' },
  { chiave: 'ripristina_configurazione', etichetta: 'Ripristina configurazione', descrizione: 'Riporta una configurazione alla versione precedente. Non tocca fatture, pagamenti o prenotazioni.', conferma: true, ambito: 'sistema' },
  { chiave: 'segna_risolto',       etichetta: 'Segna come risolto',      descrizione: 'Chiude il problema e lo sposta nello storico.', conferma: false, ambito: 'problema' },
  { chiave: 'riapri',              etichetta: 'Riapri',                  descrizione: 'Rimette il problema fra quelli aperti.', conferma: false, ambito: 'problema' },
  { chiave: 'ignora',              etichetta: 'Ignora',                  descrizione: 'Nasconde il problema dagli aperti senza cancellarlo.', conferma: true,  ambito: 'problema' },
  { chiave: 'apri_incidente',      etichetta: 'Crea rapporto tecnico',   descrizione: 'Prepara il rapporto completo da consegnare allo sviluppatore.', conferma: false, ambito: 'problema' },
  { chiave: 'riprova_piu_tardi',   etichetta: 'Riprova piu tardi',       descrizione: 'Rimanda il ritentativo di 15 minuti.', conferma: false, ambito: 'operazione' },
  { chiave: 'apri_scheda_cliente', etichetta: 'Apri scheda cliente',     descrizione: 'Porta alla scheda del cliente coinvolto.', conferma: false, ambito: 'problema' },
  { chiave: 'apri_fattura',        etichetta: 'Apri fattura',            descrizione: 'Porta alla fattura coinvolta.', conferma: false, ambito: 'problema' },
]

export const AZIONE_BY_CHIAVE: Record<string, AzioneSicura> =
  Object.fromEntries(AZIONI_SICURE.map(a => [a.chiave, a]))

// ── Endpoint interni richiamabili da un ritentativo ────────────────────────
// Un'operazione in coda puo' puntare SOLO a uno di questi. Nessun URL
// arbitrario viene mai chiamato dal worker: e' la barriera contro
// l'esecuzione di endpoint non previsti.
export const ENDPOINT_RETRY_CONSENTITI: ReadonlySet<string> = new Set([
  'send-invoice-to-sdi',
  'send-whatsapp-notification',
  'cargos-auto-send',
  'cargos-retry-missed',
  'fornitori-fatture-sync-cron',
  'generate-contract',
  'process-pending-addebiti',
])

// ── Job pianificati che il Super Admin puo' rilanciare a mano ──────────────
// Solo funzioni idempotenti: rilanciarle due volte non produce doppioni.
export const JOB_RILANCIABILI: { chiave: string; etichetta: string; funzione: string; descrizione: string }[] = [
  { chiave: 'cargos_retry',    etichetta: 'Recupero invii CARGOS',      funzione: 'cargos-retry-missed',        descrizione: 'Ricontrolla i contratti firmati e invia quelli mai trasmessi.' },
  { chiave: 'fornitori_sync',  etichetta: 'Sincronizza fatture fornitori', funzione: 'fornitori-fatture-sync-cron', descrizione: 'Riscarica le fatture fornitori dallo SDI.' },
  { chiave: 'fatture_bozza',   etichetta: 'Controllo fatture in bozza', funzione: 'fatture-bozza-alert-cron',   descrizione: 'Ricontrolla le fatture mai trasmesse e avvisa.' },
  { chiave: 'campagne',        etichetta: 'Motore campagne',            funzione: 'process-scheduled-campaigns-cron', descrizione: 'Fa girare subito un ciclo di invio delle campagne pianificate.' },
  { chiave: 'system_control',  etichetta: 'Auto-riparazione',           funzione: 'system-control-worker',      descrizione: 'Fa girare subito il ciclo di auto-riparazione e degli avvisi.' },
]

// ── Automatismi sorvegliati dal controllo orario ───────────────────────────
// Ogni funzione pianificata lascia un battito in `sc_metrics` (tipo `job`) a
// ogni giro. Il controllo orario confronta l'ultimo battito con la cadenza
// attesa: se manca, apre un problema. `ogniMinuti` e' la cadenza dichiarata
// in netlify.toml o nella chiamata `schedule(...)` dentro la funzione.
export interface CronSorvegliato {
  funzione: string
  etichetta: string
  ogniMinuti: number
  /** Cosa smette di succedere se l'automatismo non gira. */
  impatto: string
}

export const CRON_SORVEGLIATI: CronSorvegliato[] = [
  { funzione: 'process-pending-addebiti',              etichetta: 'Addebiti in attesa',              ogniMinuti: 1,     impatto: 'Gli addebiti sulle carte salvate restano fermi.' },
  { funzione: 'process-scheduled-campaigns-cron',      etichetta: 'Campagne pianificate',            ogniMinuti: 2,     impatto: 'Le campagne programmate non partono all ora prevista.' },
  { funzione: 'cancel-unpaid-nexi-bookings',           etichetta: 'Annullo prenotazioni non pagate', ogniMinuti: 5,     impatto: 'I link di pagamento scaduti restano validi e i mezzi restano occupati.' },
  { funzione: 'system-control-worker',                 etichetta: 'Auto-riparazione',                ogniMinuti: 5,     impatto: 'Le operazioni fallite non vengono piu ritentate da sole.' },
  { funzione: 'process-scheduled-system-messages-cron',etichetta: 'Messaggi programmati',            ogniMinuti: 8,     impatto: 'I messaggi programmati non partono.' },
  { funzione: 'maxi-promo-gap-cron',                   etichetta: 'Promo sui buchi di calendario',   ogniMinuti: 10,    impatto: 'Le promo automatiche sui giorni vuoti non partono.' },
  { funzione: 'reconcile-wallet-fatture-cron',         etichetta: 'Riconciliazione wallet-fatture',  ogniMinuti: 15,    impatto: 'Le ricariche wallet restano senza fattura collegata.' },
  { funzione: 'cargos-retry-missed',                   etichetta: 'Recupero invii CARGOS',           ogniMinuti: 30,    impatto: 'Le comunicazioni obbligatorie non trasmesse restano indietro.' },
  { funzione: 'check-sdi-statuses-cron',               etichetta: 'Stato fatture allo SDI',          ogniMinuti: 30,    impatto: 'Non si vede piu se una fattura e stata accettata o scartata.' },
  { funzione: 'signature-reminder',                    etichetta: 'Promemoria firma contratti',      ogniMinuti: 30,    impatto: 'I clienti non ricevono il sollecito a firmare.' },
  { funzione: 'process-wallet-auto-recharges-cron',    etichetta: 'Ricariche wallet automatiche',    ogniMinuti: 60,    impatto: 'Le ricariche automatiche del wallet non partono.' },
  { funzione: 'weather-alert-cron',                    etichetta: 'Allerta meteo',                   ogniMinuti: 60,    impatto: 'I clienti non ricevono l allerta meteo prima dell uscita.' },
  { funzione: 'send-booking-reminders',                etichetta: 'Promemoria prenotazioni',         ogniMinuti: 120,   impatto: 'I promemoria di ritiro e riconsegna non partono.' },
  { funzione: 'sollecito-pagamento-cron',              etichetta: 'Solleciti di pagamento',          ogniMinuti: 360,   impatto: 'I solleciti sulle somme da saldare non partono.' },
  { funzione: 'promo-incassi-cron',                    etichetta: 'Promo sugli incassi',             ogniMinuti: 480,   impatto: 'Le promo legate agli incassi non partono.' },
  { funzione: 'fornitori-fatture-sync-cron',           etichetta: 'Fatture fornitori dallo SDI',     ogniMinuti: 1440,  impatto: 'Le fatture dei fornitori non entrano in automatico.' },
  { funzione: 'accrue-club-wallet-interest',           etichetta: 'Interessi DR7 Club',              ogniMinuti: 1440,  impatto: 'Gli interessi del wallet Club non maturano.' },
  { funzione: 'nexi-preauth-refresh-cron',             etichetta: 'Rinnovo pre-autorizzazioni Nexi', ogniMinuti: 1440,  impatto: 'Le pre-autorizzazioni scadono senza essere rinnovate.' },
  { funzione: 'fornitori-alerts-cron',                 etichetta: 'Avvisi fornitori',                ogniMinuti: 1440,  impatto: 'Le scadenze fornitori non vengono segnalate.' },
  { funzione: 'fatture-bozza-alert-cron',              etichetta: 'Fatture rimaste in bozza',        ogniMinuti: 1440,  impatto: 'Le fatture mai trasmesse non vengono segnalate.' },
  { funzione: 'magazzino-riordino-periodico-cron',     etichetta: 'Riordino magazzino',              ogniMinuti: 1440,  impatto: 'I riordini periodici non vengono proposti.' },
  { funzione: 'vehicle-deadlines-cron',                etichetta: 'Scadenze veicoli',                ogniMinuti: 1440,  impatto: 'Bollo, revisione e assicurazione non vengono segnalati.' },
  { funzione: 'check-deposit-expiration',              etichetta: 'Scadenza cauzioni',               ogniMinuti: 1440,  impatto: 'Le cauzioni da restituire non vengono segnalate.' },
  { funzione: 'check-pre-rental-deposits',             etichetta: 'Cauzioni pre-noleggio',           ogniMinuti: 1440,  impatto: 'Le cauzioni da incassare prima del ritiro non vengono preparate.' },
  { funzione: 'check-birthdays',                       etichetta: 'Compleanni',                      ogniMinuti: 1440,  impatto: 'Gli auguri ai clienti non partono.' },
  { funzione: 'send-birthday-messages',                etichetta: 'Invio auguri',                    ogniMinuti: 1440,  impatto: 'Gli auguri ai clienti non partono.' },
  { funzione: 'immondizia-reminder-cron',              etichetta: 'Promemoria immondizia',           ogniMinuti: 1440,  impatto: 'Il promemoria della raccolta non parte.' },
  { funzione: 'sync-ipa-cron',                         etichetta: 'Sincronizzazione IPA',            ogniMinuti: 43200, impatto: 'L elenco degli enti notificatori non si aggiorna.' },
  { funzione: 'fornitori-crosscheck-cron',             etichetta: 'Controllo incrociato fornitori',  ogniMinuti: 43200, impatto: 'Le differenze fra fatture e pagamenti fornitori non emergono.' },
  { funzione: 'payout-club-wallet-interest',           etichetta: 'Pagamento interessi DR7 Club',    ogniMinuti: 43200, impatto: 'Gli interessi maturati non vengono accreditati.' },
]

/**
 * Quanto si aspetta prima di dire che un automatismo non gira piu'.
 * Tre giri saltati (e comunque mai meno di mezz'ora di pazienza): cosi' un
 * singolo ritardo di Netlify non fa scattare un falso allarme.
 */
export function tolleranzaMinuti(ogniMinuti: number): number {
  return Math.max(ogniMinuti * 3, ogniMinuti + 30)
}
