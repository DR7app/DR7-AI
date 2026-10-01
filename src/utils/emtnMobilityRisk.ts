/**
 * EMTN — Mobility Risk Report: catalogo eventi, stati e regole.
 *
 * 28/09/2026 (direzione, "Specifica funzionale definitiva per analisi
 * automatica delle segnalazioni"): l'operatore carica i documenti, l'AI
 * individua gli eventi, li classifica nelle 66 voci qui sotto ed estrae solo
 * cio' che risulta dai documenti; l'operatore rivede e conferma prima della
 * pubblicazione. Un solo file per il server (analisi e conferma) e per lo
 * schermo, cosi' categorie e regole non si separano.
 *
 * EMTN registra FATTI CONTRATTUALI documentati, mai giudizi sulla persona.
 */

export interface CategoriaEMTN {
    codice: number
    area: number
    label: string
    descrizione: string
}

export const AREE_EMTN: Record<number, string> = {
    1: 'Pagamenti',
    2: 'Contestazioni economiche',
    3: 'Accordi e regolarizzazioni',
    4: 'Danni',
    5: 'Riconsegna del veicolo',
    6: 'Utilizzo del veicolo',
    7: 'Cauzione e garanzie',
    8: 'Documentazione e contratto',
}

const c = (codice: number, area: number, label: string, descrizione: string): CategoriaEMTN => ({ codice, area, label, descrizione })

export const CATEGORIE_EMTN: CategoriaEMTN[] = [
    // AREA 1 — PAGAMENTI
    c(1, 1, 'Insoluto', 'Importo contrattualmente dovuto e scaduto che, sulla base della documentazione disponibile, risulta non corrisposto.'),
    c(2, 1, 'Pagamento parziale', "Pagamento effettuato per importo inferiore rispetto all'importo documentato come dovuto."),
    c(3, 1, 'Saldo residuo', "Presenza di una parte dell'importo originario ancora dovuta dopo uno o piu' pagamenti."),
    c(4, 1, 'Pagamento oltre scadenza', 'Importo integralmente corrisposto successivamente alla scadenza documentata.'),
    c(5, 1, 'Pagamento parziale oltre scadenza', "Pagamento tardivo che non estingue integralmente l'importo documentato come dovuto."),
    c(6, 1, 'Estensione noleggio non saldata', 'Importo relativo alla prosecuzione o estensione del noleggio rimasto insoluto.'),
    c(7, 1, 'Servizi aggiuntivi non saldati', 'Importi relativi a servizi aggiuntivi contrattualmente previsti e documentati.'),
    c(8, 1, 'Chilometri eccedenti non saldati', 'Importo relativo al superamento dei chilometri inclusi nel contratto non corrisposto.'),
    c(9, 1, 'Carburante/ricarica non saldati', 'Importo documentato relativo a carburante o ricarica dovuto alla riconsegna e non corrisposto.'),
    c(10, 1, 'Costi di recupero veicolo non saldati', "Costi documentati sostenuti dall'operatore per recuperare il veicolo e contrattualmente imputati al cliente, rimasti insoluti."),
    c(11, 1, 'Penale non saldata', 'Penale prevista da specifica clausola contrattuale, applicata per un evento documentato e non corrisposta.'),
    c(12, 1, 'Franchigia/scoperto non saldato', 'Importo documentato relativo a franchigia o scoperto rimasto insoluto.'),
    c(13, 1, 'Altro importo contrattuale non saldato', "Solo quando il documento dimostra chiaramente natura, origine e importo dell'obbligazione."),
    // AREA 2 — CONTESTAZIONI ECONOMICHE
    c(14, 2, 'Importo contestato dal cliente', "Il cliente ha formalmente contestato l'esistenza o la quantificazione dell'importo richiesto."),
    c(15, 2, 'Danno contestato (economico)', "Contestazione documentata relativa all'esistenza, attribuzione o quantificazione di un danno."),
    c(16, 2, 'Penale contestata', 'Contestazione documentata della penale applicata.'),
    c(17, 2, 'Chilometraggio contestato', "Contestazione documentata relativa ai chilometri rilevati o all'importo conseguente."),
    c(18, 2, 'Franchigia/scoperto contestato', "Contestazione documentata dell'importo richiesto."),
    c(19, 2, 'Chargeback / contestazione pagamento', 'Contestazione documentata della transazione attraverso il prestatore/circuito di pagamento. Non e\' di per se\' una frode.'),
    // AREA 3 — ACCORDI E REGOLARIZZAZIONI
    c(20, 3, 'Accordo transattivo', 'Le parti hanno documentatamente definito la controversia mediante un accordo.'),
    c(21, 3, 'Definizione a importo ridotto', "L'importo definitivamente concordato e' inferiore all'importo originariamente richiesto."),
    c(22, 3, 'Accordo parzialmente adempiuto', "E' stato raggiunto un accordo, ma risulta corrisposta soltanto parte dell'importo concordato."),
    c(23, 3, 'Accordo non adempiuto', 'Accordo documentato con obbligazioni scadute che risultano non adempiute.'),
    c(24, 3, 'Posizione regolarizzata', "L'obbligazione oggetto dell'evento risulta successivamente integralmente definita."),
    c(25, 3, 'Posizione parzialmente regolarizzata', "Parte dell'obbligazione risulta definita mentre permane un residuo documentato."),
    c(26, 3, 'Posizione chiusa senza residuo', "Non risultano ulteriori importi dovuti relativamente all'evento registrato."),
    // AREA 4 — DANNI
    c(27, 4, 'Danno al veicolo documentato', 'Presenza di un danno supportato dalla documentazione caricata.'),
    c(28, 4, 'Danno rilevato alla riconsegna', 'Il documento attesta che il danno e\' stato rilevato durante il controllo di riconsegna.'),
    c(29, 4, 'Danno rilevato successivamente', 'Il documento indica una rilevazione successiva alla riconsegna.'),
    c(30, 4, 'Danni multipli', 'Il documento identifica piu\' danni distinti.'),
    c(31, 4, 'Danno quantificato mediante preventivo', 'Documentazione con una quantificazione economica mediante preventivo.'),
    c(32, 4, 'Danno quantificato mediante perizia', 'Perizia o documento equivalente contenente la quantificazione.'),
    c(33, 4, 'Danno riparato', "Documentazione attestante l'avvenuta riparazione."),
    c(34, 4, 'Danno non saldato', "L'importo documentato e richiesto relativamente al danno risulta scaduto e non corrisposto."),
    c(35, 4, 'Danno parzialmente saldato', "Risulta corrisposta soltanto parte dell'importo documentato."),
    c(36, 4, 'Danno contestato', 'Contestazione documentata relativa al danno.'),
    // AREA 5 — RICONSEGNA DEL VEICOLO
    c(37, 5, 'Ritardo nella riconsegna', 'Il veicolo risulta restituito successivamente alla data/ora prevista.'),
    c(38, 5, 'Ritardo senza proroga autorizzata', 'La documentazione disponibile non evidenzia una proroga autorizzata.'),
    c(39, 5, 'Mancata restituzione alla scadenza', 'Alla scadenza contrattuale documentata il veicolo non risulta restituito.'),
    c(40, 5, 'Veicolo successivamente restituito', 'Una precedente mancata restituzione e\' stata definita con la riconsegna del veicolo.'),
    c(41, 5, 'Riconsegna in luogo non concordato', 'Veicolo riconsegnato in luogo differente senza modifica autorizzata documentata.'),
    c(42, 5, "Recupero del veicolo da parte dell'operatore", "La documentazione attesta che l'operatore ha dovuto procedere al recupero del veicolo."),
    c(43, 5, 'Costi conseguenti alla riconsegna irregolare', "Costi documentati direttamente collegati all'evento."),
    // AREA 6 — UTILIZZO DEL VEICOLO
    c(44, 6, 'Conducente non autorizzato', 'Utilizzo documentato da parte di soggetto non previsto/autorizzato dal contratto.'),
    c(45, 6, 'Cessione del veicolo a terzi non autorizzata', 'Disponibilita\'/utilizzo documentato da parte di terzi in violazione delle condizioni contrattuali.'),
    c(46, 6, 'Violazione territoriale', "Utilizzo documentato fuori dall'area consentita dal contratto."),
    c(47, 6, 'Espatrio non autorizzato', "Utilizzo documentato fuori dal territorio nazionale senza l'autorizzazione necessaria."),
    c(48, 6, 'Superamento del chilometraggio', 'Chilometri finali superiori al limite contrattualmente previsto.'),
    c(49, 6, 'Utilizzo non conforme al contratto', 'Violazione oggettivamente documentata di una specifica condizione di utilizzo.'),
    c(50, 6, 'Dotazione del veicolo non restituita', 'Mancata restituzione documentata di accessori o dotazioni consegnate con il veicolo.'),
    c(51, 6, 'Chiavi non restituite', 'Mancata restituzione documentata di una o piu\' chiavi.'),
    c(52, 6, 'Documenti del veicolo non restituiti', 'Mancata restituzione documentata della documentazione consegnata con il veicolo.'),
    // AREA 7 — CAUZIONE E GARANZIE
    c(53, 7, 'Cauzione non costituita', 'Cauzione prevista contrattualmente ma non perfezionata.'),
    c(54, 7, 'Cauzione parziale', 'Importo costituito inferiore a quello previsto.'),
    c(55, 7, 'Preautorizzazione non perfezionata', 'Operazione di preautorizzazione richiesta ma non completata.'),
    c(56, 7, 'Importo eccedente la cauzione non saldato', 'Importo documentato superiore alla cauzione disponibile rimasto insoluto.'),
    c(57, 7, 'Addebito cauzionale contestato', "Contestazione documentata relativa all'utilizzo della cauzione."),
    c(58, 7, 'Posizione cauzionale regolarizzata', 'Evento relativo alla cauzione successivamente definito.'),
    // AREA 8 — DOCUMENTAZIONE E CONTRATTO
    c(59, 8, 'Documentazione richiesta mancante', 'Documentazione richiesta non presente.'),
    c(60, 8, 'Documento scaduto', 'Documento con validita\' scaduta.'),
    c(61, 8, 'Documento illeggibile', 'Documento non leggibile.'),
    c(62, 8, 'Dati non coincidenti', 'Solo per difformita\' oggettive tra dati dichiarati e documentazione disponibile.'),
    c(63, 8, 'Requisiti patente non conformi al contratto', 'Patente non conforme ai requisiti contrattuali.'),
    c(64, 8, 'Mancata produzione di documentazione contrattualmente richiesta', 'Documentazione prevista dal contratto non prodotta.'),
    c(65, 8, 'Violazione di specifica clausola contrattuale', 'Violazione documentata di una clausola del contratto.'),
    c(66, 8, 'Altro inadempimento contrattuale documentato', 'Residuale: sempre con descrizione del fatto, documentazione e, se applicabile, clausola interessata. Mai giudizi personali.'),
]

export const categoriaEMTN = (codice: number): CategoriaEMTN | undefined =>
    CATEGORIE_EMTN.find(x => x.codice === codice)

/**
 * Stati standard EMTN, gli unici ammessi. IN_REVISIONE e RETTIFICATO vengono
 * dal "Workflow definitivo" (fase 12: aggiornamenti dopo la pubblicazione).
 */
export const STATI_EMTN = [
    'DA_VERIFICARE',
    'VERIFICATO',
    'CONTESTATO',
    'IN_DEFINIZIONE',
    'IN_REVISIONE',
    'PARZIALMENTE_REGOLARIZZATO',
    'REGOLARIZZATO',
    'RETTIFICATO',
    'CHIUSO',
    'ANNULLATO',
] as const
export type StatoEMTN = typeof STATI_EMTN[number]

export const etichettaStato = (s: string): string => String(s || '').replace(/_/g, ' ')

/** Stato di una contestazione o di un chargeback, quando risulta. */
export const STATI_CONTESTAZIONE = ['APERTO', 'ACCOLTO', 'RESPINTO', 'RITIRATO', 'RISOLTO', 'IMPORTO_RECUPERATO'] as const

export const NON_RISULTA = 'NON RISULTA DALLA DOCUMENTAZIONE'

/** Esito preliminare del motore di coerenza documentale (workflow, fase 4). */
export const ESITI_VERIFICA = [
    'DOCUMENTAZIONE_COERENTE',
    'DOCUMENTAZIONE_PARZIALMENTE_COMPLETA',
    'DOCUMENTAZIONE_INSUFFICIENTE',
    'INCONGRUENZA_RILEVATA',
    'DATI_NON_VERIFICABILI',
    'POTENZIALE_DUPLICAZIONE',
    'POTENZIALE_POSIZIONE_GIA_REGOLARIZZATA',
    'REVISIONE_MANUALE_OBBLIGATORIA',
] as const
export type EsitoVerifica = typeof ESITI_VERIFICA[number]

/** Decisioni della validazione finale EMTN (workflow, fase 10). */
export const DECISIONI_EMTN = [
    { id: 'approva', label: 'Approva' },
    { id: 'integrazione', label: 'Richiedi integrazione' },
    { id: 'rettifica', label: 'Rettifica prima della pubblicazione' },
    { id: 'sospendi', label: 'Sospendi' },
    { id: 'rifiuta', label: 'Rifiuta' },
    { id: 'legale', label: 'Invia a revisione privacy/legale' },
] as const
export type DecisioneEMTN = typeof DECISIONI_EMTN[number]['id']

/** Tipi di documento che l'AI riconosce nella pratica (workflow, fase 1). */
export const TIPI_DOCUMENTO: Record<string, string> = {
    contratto: 'Contratto di noleggio',
    contestazione: 'Documento di contestazione',
    checkout: 'Verbale/check-out',
    checkin: 'Verbale/check-in',
    foto: 'Documentazione fotografica',
    preventivo: 'Preventivo di riparazione',
    perizia: 'Perizia',
    fattura: 'Fattura',
    nota_debito: 'Nota di debito / documento contabile',
    franchigia: 'Documentazione franchigia/scoperto',
    penale: 'Documentazione penale',
    chilometri: 'Documentazione chilometrica',
    riconsegna: 'Documentazione riconsegna',
    richiesta_pagamento: 'Richiesta di pagamento',
    ricevuta: 'Ricevuta di pagamento',
    accordo: 'Accordo transattivo',
    comunicazione: 'Comunicazione di contestazione',
    altro: 'Altro documento pertinente',
}

/**
 * Documentazione minima per tipologia (workflow, fase 5). Ogni requisito e'
 * soddisfatto da UNO dei tipi elencati. Il contratto serve sempre: senza
 * rapporto contrattuale verificabile la pratica non procede (fase 6).
 */
const REQUISITI: { nome: string; codici: number[]; richiesti: { cosa: string; tipi: string[] }[] }[] = [
    {
        nome: 'Danno', codici: [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 15],
        richiesti: [
            { cosa: 'stato del veicolo alla riconsegna o dopo', tipi: ['checkin', 'foto', 'perizia', 'riconsegna'] },
            { cosa: 'quantificazione (preventivo, perizia o documento contabile)', tipi: ['preventivo', 'perizia', 'fattura', 'nota_debito', 'richiesta_pagamento'] },
        ],
    },
    {
        nome: 'Insoluto', codici: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 56],
        richiesti: [
            { cosa: 'documentazione contabile o richiesta di pagamento', tipi: ['fattura', 'nota_debito', 'richiesta_pagamento'] },
        ],
    },
    {
        nome: 'Penale', codici: [11, 16],
        richiesti: [
            { cosa: "documentazione dell'evento che determina la penale", tipi: ['penale', 'checkin', 'checkout', 'riconsegna', 'chilometri', 'foto', 'comunicazione'] },
        ],
    },
    {
        nome: 'Ritardo nella riconsegna', codici: [37, 38, 39, 40, 41, 42, 43],
        richiesti: [
            { cosa: 'data/ora effettiva di riconsegna', tipi: ['checkin', 'riconsegna'] },
        ],
    },
]

/** Requisiti minimi non soddisfatti dai documenti della pratica. */
export function documentiMinimiMancanti(codici: number[], tipiPresenti: string[]): string[] {
    const presenti = new Set(tipiPresenti)
    const mancanti: string[] = []
    if (codici.length > 0 && !presenti.has('contratto')) mancanti.push('Contratto di noleggio (rapporto contrattuale non verificabile)')
    for (const r of REQUISITI) {
        if (!codici.some(c => r.codici.includes(c))) continue
        for (const req of r.richiesti) {
            if (!req.tipi.some(t => presenti.has(t))) mancanti.push(`${r.nome}: ${req.cosa}`)
        }
    }
    return mancanti
}

/** Un controllo incrociato con il gestionale DR7 (workflow, fase 3). */
export interface ControlloGestionale {
    controllo: string
    esito: 'ok' | 'diverso' | 'non_trovato' | 'info'
    documento?: string | null
    gestionale?: string | null
}

/**
 * Dati da estrarre per ogni evento. Testo o numero quando risulta dai
 * documenti; `null` = non risulta (a schermo e nel report:
 * "NON RISULTA DALLA DOCUMENTAZIONE").
 */
export const CAMPI_EVENTO: { chiave: string; label: string; tipo: 'testo' | 'data' | 'dataora' | 'importo' }[] = [
    { chiave: 'sottotipologia', label: 'Sottotipologia', tipo: 'testo' },
    { chiave: 'data_evento', label: "Data dell'evento", tipo: 'data' },
    { chiave: 'numero_contratto', label: 'Numero contratto/pratica', tipo: 'testo' },
    { chiave: 'veicolo', label: 'Veicolo', tipo: 'testo' },
    { chiave: 'targa', label: 'Targa', tipo: 'testo' },
    { chiave: 'data_inizio_noleggio', label: 'Data inizio noleggio', tipo: 'data' },
    { chiave: 'data_fine_noleggio', label: 'Data fine noleggio', tipo: 'data' },
    { chiave: 'riconsegna_prevista', label: 'Riconsegna prevista', tipo: 'dataora' },
    { chiave: 'riconsegna_effettiva', label: 'Riconsegna effettiva', tipo: 'dataora' },
    { chiave: 'importo_richiesto', label: 'Importo originariamente richiesto', tipo: 'importo' },
    { chiave: 'importo_dovuto', label: 'Importo definitivamente dovuto', tipo: 'importo' },
    { chiave: 'importo_contestato', label: 'Importo contestato', tipo: 'importo' },
    { chiave: 'importo_pagato', label: 'Importo pagato', tipo: 'importo' },
    { chiave: 'importo_residuo', label: 'Importo residuo', tipo: 'importo' },
    { chiave: 'data_scadenza', label: 'Data di scadenza', tipo: 'data' },
    { chiave: 'data_pagamento', label: 'Data del pagamento', tipo: 'data' },
    { chiave: 'accordo', label: 'Accordo', tipo: 'testo' },
    { chiave: 'data_accordo', label: "Data dell'accordo", tipo: 'data' },
    { chiave: 'stato_accordo', label: "Stato dell'accordo", tipo: 'testo' },
    { chiave: 'clausola', label: 'Clausola contrattuale interessata', tipo: 'testo' },
    { chiave: 'stato_contestazione', label: 'Stato della contestazione', tipo: 'testo' },
    // 01/10/2026: per l'EMTN Score (src/utils/emtnScore), ricavati dai documenti.
    { chiave: 'comunicazione_cliente', label: "Comunicazione dell'evento da parte del cliente (SPONTANEA / SU_RICHIESTA / OMESSA)", tipo: 'testo' },
    { chiave: 'responsabilita', label: 'Responsabilita\' (ACCERTATA / CONTESTATA / NON_ATTRIBUIBILE)', tipo: 'testo' },
]

export type DatiEvento = Record<string, string | number | null>

export interface EventoEMTN {
    codice: number
    stato: StatoEMTN
    dati: DatiEvento
    /** Nomi dei documenti da cui risulta. */
    fonti: string[]
}

/** Dati della pratica ricostruiti dai documenti (workflow, fase 2). */
export const CAMPI_PRATICA: { chiave: string; label: string }[] = [
    { chiave: 'cliente', label: 'Cliente' },
    { chiave: 'codice_fiscale', label: 'Codice fiscale' },
    { chiave: 'numero_contratto', label: 'Numero contratto' },
    { chiave: 'data_contratto', label: 'Data contratto' },
    { chiave: 'veicolo', label: 'Veicolo' },
    { chiave: 'targa', label: 'Targa' },
    { chiave: 'inizio_noleggio', label: 'Inizio noleggio' },
    { chiave: 'fine_noleggio', label: 'Fine noleggio prevista' },
    { chiave: 'consegna', label: 'Data/ora consegna' },
    { chiave: 'riconsegna_prevista', label: 'Riconsegna prevista' },
    { chiave: 'riconsegna_effettiva', label: 'Riconsegna effettiva' },
]

export interface RisultatoAnalisi {
    eventi: EventoEMTN[]
    stato_posizione: StatoEMTN
    titolo: string
    report: string
    /** Informazioni di natura legale/penale: MAI pubblicate nel report. */
    informazioni_legali: string[]
    /** Dati della pratica ricostruiti dai documenti. */
    pratica: Record<string, string | null>
    /** Tipo di ciascun documento caricato: [{ nome, tipo }]. */
    documenti: { nome: string; tipo: string }[]
    /** Incongruenze tra documenti: l'AI le segnala, non sceglie l'importo giusto. */
    incongruenze: string[]
    /** Affermazioni presenti nei documenti ma non supportate da prova. */
    non_supportate: string[]
    esito_verifica: EsitoVerifica
}

// ── Regole ──────────────────────────────────────────────────

/**
 * Giudizi sulla persona vietati dalla specifica (e varianti ovvie). Il testo
 * pubblicato non li puo' contenere, qualunque cosa abbia scritto l'AI o
 * l'operatore.
 */
const GIUDIZI_VIETATI: RegExp[] = [
    /client[ei]\s+(cattiv|problematic|pericolos|inaffidabil|disonest|aggressiv|da\s+evitare|truffator|moros[oi]\s+abitual)/i,
    /\b(truffator[ei]|disonest[oi]|inaffidabil[ei]|malintenzionat[oi]|delinquent[ei])\b/i,
    /\bmoros[oi]\s+abitual[ei]\b/i,
    /\bda\s+evitare\b/i,
]

/** Qualificazioni di natura penale: vanno separate e MAI pubblicate. */
const TERMINI_PENALI: RegExp[] = [
    /\bfurt[oi]\b/i, /\btruff[ae]\b/i, /appropriazione\s+indebita/i, /\bfalsificazion[ei]\b/i, /\bfalsificat[oaie]\b/i,
    /\bdenunciat[oaie]\b/i, /\bdenunci[ae]\b/i, /procediment[oi]\s+penal[ei]/i, /\bcondann[ae]\b/i, /\bcondannat[oaie]\b/i,
    /\bindagat[oaie]\b/i, /\bquerel[ae]\b/i, /\bquerelat[oaie]\b/i, /\breat[oi]\b/i, /\bricettazione\b/i,
]

export const AVVISO_LEGALE = 'POTENZIALE INFORMAZIONE SOGGETTA A REGIME GIURIDICO SPECIFICO – REVISIONE PRIVACY/LEGALE RICHIESTA'

export function giudiziVietati(testo: string): string[] {
    const trovati: string[] = []
    for (const re of GIUDIZI_VIETATI) {
        const m = String(testo || '').match(re)
        if (m) trovati.push(m[0])
    }
    return trovati
}

export function terminiPenali(testo: string): string[] {
    const trovati: string[] = []
    for (const re of TERMINI_PENALI) {
        const m = String(testo || '').match(re)
        if (m) trovati.push(m[0])
    }
    return trovati
}

function numero(v: unknown): number | null {
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

/**
 * Ritardo tra riconsegna prevista ed effettiva, in giorni/ore/minuti.
 * null quando una delle due manca o non e' un ritardo.
 */
export function calcolaRitardo(prevista: unknown, effettiva: unknown): { minuti: number; testo: string } | null {
    const a = Date.parse(String(prevista || ''))
    const b = Date.parse(String(effettiva || ''))
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null
    const minuti = Math.round((b - a) / 60000)
    const g = Math.floor(minuti / 1440)
    const h = Math.floor((minuti % 1440) / 60)
    const m = minuti % 60
    const parti = [g ? `${g} ${g === 1 ? 'giorno' : 'giorni'}` : '', h ? `${h} ${h === 1 ? 'ora' : 'ore'}` : '', m ? `${m} ${m === 1 ? 'minuto' : 'minuti'}` : '']
    return { minuti, testo: parti.filter(Boolean).join(', ') || '0 minuti' }
}

/**
 * Residuo di un evento. REGOLA FONDAMENTALE della specifica: se c'e' un
 * importo definitivamente dovuto (accordo), il residuo si calcola su quello,
 * mai sull'importo originariamente richiesto. 2.000 richiesti, 1.500
 * concordati e 1.500 pagati = residuo 0, non 500.
 */
export function residuoEvento(dati: DatiEvento): number | null {
    const dovuto = numero(dati.importo_dovuto)
    const richiesto = numero(dati.importo_richiesto)
    const pagato = numero(dati.importo_pagato)
    const base = dovuto ?? richiesto
    if (base == null || pagato == null) return numero(dati.importo_residuo)
    return Math.max(0, Math.round((base - pagato) * 100) / 100)
}

const CODICI_VALIDI = new Set(CATEGORIE_EMTN.map(x => x.codice))

/**
 * Normalizza e controlla un risultato (dall'AI o dall'operatore) prima di
 * salvarlo o pubblicarlo. Non inventa nulla: toglie cio' che non e' ammesso,
 * ricalcola residuo e ritardo dove i dati ci sono, e restituisce gli errori
 * che bloccano la pubblicazione.
 */
export function normalizzaRisultato(input: unknown): { risultato: RisultatoAnalisi; errori: string[]; avvisi: string[] } {
    const errori: string[] = []
    const avvisi: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (input || {}) as any
    const statoOk = (s: unknown): StatoEMTN => (STATI_EMTN as readonly string[]).includes(String(s)) ? String(s) as StatoEMTN : 'DA_VERIFICARE'

    const eventi: EventoEMTN[] = []
    for (const e of Array.isArray(r.eventi) ? r.eventi : []) {
        const codice = Number(e?.codice)
        if (!CODICI_VALIDI.has(codice)) { avvisi.push(`Evento scartato: categoria ${e?.codice} non esiste`); continue }
        const dati: DatiEvento = {}
        for (const campo of CAMPI_EVENTO) {
            const v = e?.dati?.[campo.chiave]
            if (v == null || v === '' || String(v).toUpperCase() === NON_RISULTA) { dati[campo.chiave] = null; continue }
            dati[campo.chiave] = campo.tipo === 'importo' ? numero(v) : String(v).trim()
        }
        const residuo = residuoEvento(dati)
        if (residuo != null) {
            const dichiarato = numero(dati.importo_residuo)
            if (dichiarato != null && Math.abs(dichiarato - residuo) > 0.01) {
                avvisi.push(`${categoriaEMTN(codice)?.label}: residuo corretto da €${dichiarato} a €${residuo} (importo dovuto meno pagato)`)
            }
            dati.importo_residuo = residuo
        }
        const ritardo = calcolaRitardo(dati.riconsegna_prevista, dati.riconsegna_effettiva)
        dati.ritardo = ritardo ? ritardo.testo : null
        eventi.push({
            codice,
            stato: statoOk(e?.stato),
            dati,
            fonti: Array.isArray(e?.fonti) ? e.fonti.map((f: unknown) => String(f)).filter(Boolean) : [],
        })
    }

    const titolo = String(r.titolo || '').trim()
    const report = String(r.report || '').trim()
    const lista = (v: unknown): string[] => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : []
    const legali = lista(r.informazioni_legali)
    const pratica: Record<string, string | null> = {}
    for (const campo of CAMPI_PRATICA) {
        const v = r?.pratica?.[campo.chiave]
        pratica[campo.chiave] = v == null || v === '' || String(v).toUpperCase() === NON_RISULTA ? null : String(v).trim()
    }
    const documenti = (Array.isArray(r.documenti) ? r.documenti : [])
        .map((d: { nome?: unknown; tipo?: unknown }) => ({ nome: String(d?.nome || ''), tipo: TIPI_DOCUMENTO[String(d?.tipo)] ? String(d?.tipo) : 'altro' }))
        .filter((d: { nome: string }) => d.nome)
    const incongruenze = lista(r.incongruenze)
    const nonSupportate = lista(r.non_supportate)
    const esito: EsitoVerifica = (ESITI_VERIFICA as readonly string[]).includes(String(r.esito_verifica))
        ? String(r.esito_verifica) as EsitoVerifica
        : 'DATI_NON_VERIFICABILI'

    // Qualificazioni penali finite nel testo pubblicabile: fuori, e segnalate.
    const penaliNelTesto = [...terminiPenali(titolo), ...terminiPenali(report)]
    if (penaliNelTesto.length) {
        errori.push(`Il report contiene qualificazioni di natura penale (${[...new Set(penaliNelTesto)].join(', ')}): vanno tolte dal testo e lasciate nella sezione riservata. ${AVVISO_LEGALE}`)
    }
    const giudizi = [...giudiziVietati(titolo), ...giudiziVietati(report)]
    if (giudizi.length) {
        errori.push(`Il report contiene giudizi sulla persona non ammessi (${[...new Set(giudizi)].join(', ')}): descrivere solo il fatto documentato.`)
    }
    if (eventi.length === 0) errori.push('Nessun evento documentato da pubblicare.')
    if (!report) errori.push('Il testo del report e\' vuoto.')

    return {
        risultato: {
            eventi,
            stato_posizione: statoOk(r.stato_posizione),
            titolo,
            report,
            informazioni_legali: legali,
            pratica,
            documenti,
            incongruenze,
            non_supportate: nonSupportate,
            esito_verifica: esito,
        },
        errori,
        avvisi,
    }
}

/**
 * Motivi per cui la pratica NON puo' procedere da sola verso la
 * pubblicazione (workflow, fase 6 + controllo anti-abuso). Se la lista non e'
 * vuota: REVISIONE MANUALE OBBLIGATORIA. Non impedisce l'invio in
 * approvazione: e' la direzione EMTN a decidere, con i motivi davanti.
 */
export function motiviRevisioneManuale(r: RisultatoAnalisi, controlli: ControlloGestionale[] = []): string[] {
    const motivi: string[] = []
    const mancanti = documentiMinimiMancanti(r.eventi.map(e => e.codice), r.documenti.map(d => d.tipo))
    for (const m of mancanti) motivi.push(`Documentazione minima mancante: ${m}`)
    for (const inc of r.incongruenze) motivi.push(`Incongruenza: ${inc}`)
    for (const n of r.non_supportate) motivi.push(`Affermazione non supportata dalla documentazione: ${n}`)
    if (r.informazioni_legali.length) motivi.push(`Dati relativi a reati o procedimenti: ${AVVISO_LEGALE}`)
    for (const c of controlli) {
        if (c.esito === 'diverso') motivi.push(`Gestionale: ${c.controllo} non corrisponde (documento: ${c.documento || '-'}, gestionale: ${c.gestionale || '-'})`)
    }
    const residuoAperto = r.eventi.some(e => Number(e.dati.importo_residuo) > 0)
    const presentataAperta = r.eventi.some(e => [1, 3, 11, 34].includes(e.codice))
    if (presentataAperta && !residuoAperto && r.eventi.some(e => e.dati.importo_pagato != null)) {
        motivi.push('La posizione risulta integralmente pagata ma e\' presentata come ancora insoluta')
    }
    if (['DOCUMENTAZIONE_INSUFFICIENTE', 'INCONGRUENZA_RILEVATA', 'DATI_NON_VERIFICABILI', 'POTENZIALE_DUPLICAZIONE', 'POTENZIALE_POSIZIONE_GIA_REGOLARIZZATA', 'REVISIONE_MANUALE_OBBLIGATORIA'].includes(r.esito_verifica)) {
        motivi.push(`Esito della verifica: ${r.esito_verifica.replace(/_/g, ' ')}`)
    }
    return [...new Set(motivi)]
}
