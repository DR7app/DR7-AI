# DR7 A.I System Control

Centro operativo tecnico del gestionale. Serve a una cosa sola: permettere al
Super Admin di capire e risolvere da solo la maggior parte dei problemi
quotidiani, e di sapere con certezza quando invece serve davvero uno
sviluppatore.

Sta in **Sistemi > System Control** e la vedono solo `direzione` e `developer`.

## Cosa fa

| Area | Cosa risolve |
|---|---|
| Stato generale | Database, accessi, archivio file, coda, integrazioni, prestazioni in una schermata |
| Problemi | Errori raggruppati per impronta, tradotti in italiano, con diagnosi automatica e azioni |
| Collegamenti | Salute di ogni servizio esterno, test reale, riconnessione, risincronizzazione |
| Operazioni ferme | Cosa non e andato a buon fine e ripresa protetta dai doppioni |
| Interruttori | Spegnere o mettere in manutenzione una funzione, per una azienda o per tutte |
| Strumenti | Rilanciare un automatismo, svuotare le cache, sbloccare un account |
| Prestazioni | Funzioni lente, dove si sbaglia di piu |
| Storico | Audit di ogni intervento, configurazioni con ripristino, avvisi, rilasci, backup |
| Rapporti tecnici | Il documento completo da consegnare allo sviluppatore |

## Il controllo orario

`system-control-controllo-orario` gira **ogni ora** (pianificato in
`netlify.toml`) e fa il giro completo della piattaforma. Il verbale finisce in
`sc_actions_log` con azione `controllo_orario` e si legge in **Stato generale
> Controllo orario**. Lo stesso giro si lancia a mano con il pulsante
"Controlla adesso": non passa da HTTP, chiama direttamente
`eseguiControlloOrario()` dentro `system-control-actions`.

Sei controlli, tutti in sola lettura — non modificano dati, non inviano niente
ai clienti, non toccano il codice:

1. **Database** — risponde, e in quanto tempo.
2. **Collegamenti** — prova davvero ogni integrazione (`systemControlTest.ts`)
   e aggiorna `sc_integrations`. Un servizio **mai configurato** non e' un
   guasto: si segnala e basta. Guasto e' quando le credenziali ci sono a meta'
   o il servizio risponde male.
3. **Automatismi fermi** — il caso piu' pericoloso, perche' un cron che non
   gira non produce nessun errore. Ogni automatismo sorvegliato
   (`CRON_SORVEGLIATI`) e' avvolto in `conSystemControl(nome, handler, { cron:
   true })` e lascia un **battito** in `sc_metrics` (tipo `job`) a ogni giro.
   Il controllo confronta l'ultimo battito con la cadenza dichiarata e apre un
   problema se mancano tre giri.
4. **Operazioni ferme** — quante hanno smesso di ritentare e aspettano una
   persona.
5. **Errori dell'ultima ora** — quanti nuovi, quanti gravi, quanti da passare
   allo sviluppatore.
6. **Funzioni** — quali stanno restituendo errori o sono diventate lente.

Quello che trova diventa un problema normale del pannello, con severita',
classe di risoluzione e azioni suggerite. Gli avvisi verso l'esterno restano
compito del worker di auto-riparazione, che li raggruppa: cosi' un guasto non
manda un messaggio a ogni controllo.

### Aggiungere un automatismo alla sorveglianza

1. Una riga in `CRON_SORVEGLIATI` (`utils/systemControlCatalog.ts`) con la
   cadenza reale in minuti e cosa smette di succedere se si ferma.
2. Nella funzione: `export const handler = schedule('...', conSystemControl('nome-funzione', handlerVero, { cron: true }))`
   (oppure, per chi e' pianificato da `netlify.toml`, si avvolge l'handler
   esportato). Senza il battito il controllo dira' per sempre "nessun giro
   registrato".

## Le tre categorie di problema

1. **Si risolve da solo** — il ciclo di auto-riparazione ritenta con ritardo
   crescente (1, 5, 15, 60, 180 minuti) e chiude il problema quando rientra.
2. **Lo risolve il Super Admin** — il pannello propone l'azione sicura.
3. **Serve lo sviluppatore** — niente tentativi pericolosi: si genera un
   rapporto tecnico con tutto quello che serve per riprodurre il problema.

## Come non si duplicano fatture, pagamenti e contratti

Ogni operazione in coda ha una **chiave di idempotenza UNIQUE**
(`sc_operations.chiave_idempotenza`). Prima di ritentare:

- un'operazione gia `riuscita` non viene mai rieseguita;
- il passaggio a `in_corso` e una scrittura condizionata: se due processi ci
  provano insieme, uno solo vince;
- si chiama solo un endpoint della whitelist (`ENDPOINT_RETRY_CONSENTITI`),
  mai un URL arbitrario;
- fatture SDI e messaggi WhatsApp sono accodati con `automatica: false`:
  li ritenta **solo una persona**, mai il cron. Rispedire una fattura la
  rinumera, e un messaggio potrebbe arrivare due volte al cliente.

## Interruttore automatico (circuit breaker)

Dopo 5 fallimenti di fila su un'integrazione le chiamate si fermano per 10
minuti. Le operazioni **restano in coda**, non si perdono, e riprendono quando
il collegamento torna. Dopo la pausa il circuito passa in prova (`semiaperto`):
la prima chiamata che riesce lo richiude.

## Credenziali

Non escono mai dal server. Il pannello mostra solo il **nome** della variabile
d'ambiente e se e valorizzata. Ogni testo scritto nel database passa da
`sanifica()` / `mascheraTesto()`: token JWT, chiavi, password, bearer e chiavi
private diventano `[nascosto]`.

## Installazione

1. Esegui `supabase/migrations/20260831_system_control.sql` nel SQL editor di
   Supabase. Finche' non gira, il gestionale funziona normalmente e la tab
   dice che la migrazione manca: nessuna scrittura, nessun errore.
2. I due cron sono gia in `netlify.toml`: `system-control-worker` (ogni 5
   minuti, auto-riparazione) e `system-control-controllo-orario` (ogni ora,
   giro completo).
3. Variabili d'ambiente **facoltative**:
   - `SYSTEM_CONTROL_ALERT_PHONES` — numeri (CSV) che ricevono su WhatsApp i
     soli problemi **critici**. Senza questa variabile gli avvisi restano nel
     pannello.
   - `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` — per leggere lo stato
     dei backup.
   - `NETLIFY_API_TOKEN` + `SITE_ID` — per il pulsante che svuota la cache CDN.
   - `ANTHROPIC_API_KEY` — assistente diagnostico (gia presente per le altre
     funzioni AI). Senza, la diagnostica automatica funziona lo stesso.

## Cosa NON fa, di proposito

- Non modifica il codice sorgente.
- Non azzera database, non cancella aziende, tabelle o dati.
- Non ripristina backup di produzione.
- Non da all'AI accesso al database: l'assistente riceve un riassunto gia
  sanificato e restituisce testo.
- Non risolve un errore cancellandolo: un problema chiuso resta nello storico,
  e se si ripresenta torna aperto da solo.

## Aggiungere una nuova integrazione o funzione

- Integrazione: una riga in `INTEGRAZIONI` (`utils/systemControlCatalog.ts`) e
  una in `sc_integrations`. Poi, nel codice che la chiama,
  `segnaChiamata(chiave, ok, {...})` oppure `chiamataEsterna(chiave, fn)`.
- Funzione spegnibile: una riga in `FUNZIONI_SPEGNIBILI`
  (`system-control-flags.ts`) e, dove serve, `statoFunzione(chiave, business)`.
- Endpoint ripetibile: aggiungerlo a `ENDPOINT_RETRY_CONSENTITI` **solo** se
  rieseguirlo due volte non produce doppioni.
