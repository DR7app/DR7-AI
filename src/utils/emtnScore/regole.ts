/**
 * EMTN Score — regole di punteggio della direzione (05/10/2026, "MTN —
 * Regole di punteggio clienti"). Fonte UNICA dei punti: il motore
 * (motore.ts), il prompt dell'AI (emtnAnalisiAI.ts) e la scheda leggono da qui.
 *
 * L'AI propone solo la CATEGORIA; i punti li calcola questo file con regole
 * fisse. Una categoria che non esiste qui = revisione umana, mai punti
 * inventati.
 */

export const PUNTEGGIO_INIZIALE = 50
export const PUNTEGGIO_MINIMO = 0
export const PUNTEGGIO_MASSIMO = 100

/** Noleggio concluso senza problemi e completamente pagato. */
export const BONUS_NOLEGGIO_PERFETTO = 10
/** Extra acquistati e pagati: +1 per noleggio, qualunque sia il numero di extra. */
export const BONUS_EXTRA = 1
/** Aumento massimo per noleggio, bonus extra compreso. */
export const AUMENTO_MASSIMO_NOLEGGIO = 10

/** Rientro dopo il saldo integrale di un insoluto verificato. */
export const DETRAZIONE_INSOLUTO = 10
export const RIENTRO_MASSIMO_INSOLUTO = 40

export type EffettoRegola =
    | 'blocco_sicurezza'      // 0/100, nessuna risalita automatica
    | 'revisione_sicurezza'   // punti + revisione di sicurezza
    | 'verifica_immediata'    // punti + verifica immediata
    | 'revisione_umana'       // nessun punto: decide una persona

export type GruppoRegola =
    | 'Operazioni neutre'
    | 'Annullamenti'
    | 'Pagamenti'
    | 'Ritardi e riconsegna'
    | 'Carburante, pulizia e dotazioni'
    | 'Multe e incidenti'
    | 'Danni'
    | 'Violazioni gravi'
    | 'Debiti'
    | 'Altro'

export interface RegolaScore {
    id: CategoriaScore
    gruppo: GruppoRegola
    label: string
    /** Punti fissi. null = a scaglioni (vedi puntiCategoria). */
    punti: number | null
    effetto?: EffettoRegola
    /** Guida per l'AI e per chi legge la scheda. */
    descrizione: string
}

export type CategoriaScore =
    // Operazioni neutre (0)
    | 'proroga'
    | 'secondo_guidatore'
    | 'cauzione_regolare'
    | 'riconsegna_anticipata'
    | 'preventivo'
    | 'non_imputabile'
    | 'annullamento_azienda'
    | 'modifica_approvata'
    | 'km_extra'
    | 'regolarizzazione'
    // Annullamenti di prenotazioni confermate
    | 'annullamento_5g'
    | 'annullamento_48h_5g'
    | 'annullamento_24_48h'
    | 'annullamento_meno_24h'
    | 'mancata_presentazione'
    | 'annullamento_giustificato'
    // Pagamenti
    | 'pagamento_tardivo'
    | 'ritardo_bancario'
    | 'pagamento_respinto_sostituito'
    // Ritardi e riconsegna
    | 'ritardo_ritiro'
    | 'ritardo_riconsegna'
    | 'riconsegna_luogo_diverso'
    | 'ritardo_autorizzato'
    // Carburante, pulizia, dotazioni
    | 'carburante'
    | 'ricarica'
    | 'pulizia'
    | 'fumo'
    | 'animali'
    | 'accessorio'
    | 'documenti_veicolo'
    | 'chiavi'
    // Multe e incidenti
    | 'multa'
    | 'incidente_terzi'
    // Danni
    | 'danno'
    // Violazioni gravi
    | 'guidatore_non_autorizzato'
    | 'fuori_area'
    | 'uso_vietato'
    | 'subnoleggio'
    | 'manomissione'
    | 'alterazione'
    | 'occultamento_danno'
    | 'frode'
    | 'furto'
    // Debiti
    | 'insoluto'
    | 'addebito_contestato'
    // Fuori dalle regole
    | 'non_previsto'

const r = (id: CategoriaScore, gruppo: GruppoRegola, label: string, punti: number | null, descrizione: string, effetto?: EffettoRegola): RegolaScore =>
    ({ id, gruppo, label, punti, descrizione, ...(effetto ? { effetto } : {}) })

export const REGOLE_SCORE: RegolaScore[] = [
    r('proroga', 'Operazioni neutre', 'Proroga autorizzata e pagata', 0, 'Non costituisce un nuovo noleggio ai fini del punteggio.'),
    r('secondo_guidatore', 'Operazioni neutre', 'Secondo guidatore autorizzato', 0, 'Guidatore aggiuntivo previsto dal contratto.'),
    r('cauzione_regolare', 'Operazioni neutre', 'Cauzione versata correttamente', 0, 'Cauzione costituita come da contratto.'),
    r('riconsegna_anticipata', 'Operazioni neutre', 'Riconsegna anticipata concordata', 0, 'Riconsegna prima della data prevista, concordata.'),
    r('preventivo', 'Operazioni neutre', 'Preventivo non accettato o richiesta di informazioni', 0, 'Nessun noleggio concluso.'),
    r('non_imputabile', 'Operazioni neutre', 'Danno preesistente, usura normale o guasto non imputabile', 0, 'Danno o guasto non attribuibile al cliente.'),
    r('annullamento_azienda', 'Operazioni neutre', "Annullamento da parte dell'azienda", 0, "Prenotazione annullata dall'operatore."),
    r('modifica_approvata', 'Operazioni neutre', 'Modifica di date o orari approvata', 0, "Cambio date/orari approvato dall'operatore."),
    r('km_extra', 'Operazioni neutre', 'Chilometri extra pagati', 0, 'Chilometri eccedenti saldati: nessuna detrazione. Se non pagati vale la regola dei debiti.'),
    r('regolarizzazione', 'Operazioni neutre', 'Accordo o regolarizzazione', 0, "Accordo, saldo o chiusura della posizione: cambia lo stato del pagamento, non da' punti."),

    r('annullamento_5g', 'Annullamenti', 'Annullamento almeno 5 giorni prima del ritiro', -1, 'Prenotazione confermata annullata dal cliente almeno 5 giorni prima del ritiro.'),
    r('annullamento_48h_5g', 'Annullamenti', 'Annullamento da 48 ore a meno di 5 giorni prima', -2, 'Prenotazione confermata annullata dal cliente tra 48 ore e 5 giorni prima del ritiro.'),
    r('annullamento_24_48h', 'Annullamenti', 'Annullamento da 24 a meno di 48 ore prima', -3, 'Prenotazione confermata annullata dal cliente tra 24 e 48 ore prima del ritiro.'),
    r('annullamento_meno_24h', 'Annullamenti', 'Annullamento meno di 24 ore prima', -5, 'Prenotazione confermata annullata dal cliente meno di 24 ore prima del ritiro.'),
    r('mancata_presentazione', 'Annullamenti', 'Mancata presentazione senza avviso', -8, 'Il cliente non si e\' presentato al ritiro e non ha avvisato.'),
    r('annullamento_giustificato', 'Annullamenti', 'Annullamento per causa documentata riconosciuta dalla direzione', 0, 'Causa documentata e riconosciuta dalla direzione.'),

    r('pagamento_tardivo', 'Pagamenti', 'Pagamento tardivo, poi saldato', null, 'Importo saldato dopo la scadenza: fino a 2 giorni -1, fino a 7 giorni -2, oltre 7 giorni -10 (vale come insoluto saldato).'),
    r('ritardo_bancario', 'Pagamenti', 'Ritardo bancario documentato non imputabile al cliente', 0, 'Il ritardo dipende dalla banca o dal circuito, documentato.'),
    r('pagamento_respinto_sostituito', 'Pagamenti', 'Pagamento respinto, sostituito entro la scadenza', 0, 'Pagamento rifiutato e sostituito entro la scadenza.'),

    r('ritardo_ritiro', 'Ritardi e riconsegna', 'Ritardo al ritiro oltre 30 minuti senza avviso e con disservizio', -1, 'Ritardo al ritiro oltre 30 minuti, senza avviso, che ha causato un disservizio.'),
    r('ritardo_riconsegna', 'Ritardi e riconsegna', 'Ritardo alla riconsegna', null, 'Fino a 30 minuti 0; fino a 2 ore -1; fino a 6 ore -2; fino a 24 ore -10; oltre 24 ore senza autorizzazione -30 con verifica immediata.'),
    r('riconsegna_luogo_diverso', 'Ritardi e riconsegna', 'Riconsegna in un luogo diverso senza autorizzazione', -3, 'Veicolo riconsegnato in un luogo non concordato.'),
    r('ritardo_autorizzato', 'Ritardi e riconsegna', 'Ritardo o luogo diverso preventivamente autorizzati', 0, "Autorizzazione preventiva dell'operatore."),

    r('carburante', 'Carburante, pulizia e dotazioni', 'Carburante mancante', -1, 'Carburante inferiore al livello di consegna, importo pagato.'),
    r('ricarica', 'Carburante, pulizia e dotazioni', 'Ricarica elettrica inferiore al livello concordato', -1, 'Ricarica inferiore al livello concordato, importo pagato.'),
    r('pulizia', 'Carburante, pulizia e dotazioni', 'Pulizia straordinaria', -2, 'Pulizia o igienizzazione straordinaria addebitata.'),
    r('fumo', 'Carburante, pulizia e dotazioni', 'Fumo nel veicolo', -10, 'Fumo nel veicolo. La pulizia dovuta allo stesso fumo non si conta a parte.'),
    r('animali', 'Carburante, pulizia e dotazioni', 'Animali trasportati in violazione del contratto', -3, 'Animali a bordo in violazione del contratto.'),
    r('accessorio', 'Carburante, pulizia e dotazioni', 'Accessorio perso o mancante', -2, 'Accessorio o dotazione del veicolo non restituiti.'),
    r('documenti_veicolo', 'Carburante, pulizia e dotazioni', 'Documenti del mezzo persi', -3, 'Libretto o documenti del veicolo non restituiti.'),
    r('chiavi', 'Carburante, pulizia e dotazioni', 'Chiavi perse', -5, 'Una o piu\' chiavi non restituite.'),

    r('multa', 'Multe e incidenti', 'Multa attribuita al cliente', -2, 'Per verbale, non per ogni notifica.'),
    r('incidente_terzi', 'Multe e incidenti', 'Incidente con responsabilita\' esclusiva di terzi accertata', -5, "Registra il coinvolgimento nell'incidente, NON una condotta scorretta del cliente. Con responsabilita' del cliente vale solo la detrazione del danno."),

    r('danno', 'Danni', 'Danno attribuibile al cliente', null, 'Sul costo documentato, esclusi usura e danni preesistenti: fino a 300 EUR -5; fino a 1.000 -10; fino a 3.000 -20; fino a 10.000 -35; oltre -50. Piu\' componenti dello stesso incidente = un evento.'),

    r('guidatore_non_autorizzato', 'Violazioni gravi', 'Guidatore non autorizzato', -25, 'Veicolo guidato da una persona non autorizzata.'),
    r('fuori_area', 'Violazioni gravi', "Uscita dall'area consentita senza autorizzazione", -15, "Utilizzo fuori dall'area o dal territorio consentiti."),
    r('uso_vietato', 'Violazioni gravi', 'Uso su pista, competizioni o uso espressamente vietato', -35, 'Uso espressamente vietato dal contratto.'),
    r('subnoleggio', 'Violazioni gravi', 'Subnoleggio o cessione del mezzo non autorizzati', -40, 'Veicolo ceduto o subnoleggiato a terzi.'),
    r('manomissione', 'Violazioni gravi', 'Manomissione dei dispositivi di sicurezza o localizzazione', -50, 'Manomissione di GPS, antifurto o dispositivi di sicurezza.', 'revisione_sicurezza'),
    r('alterazione', 'Violazioni gravi', 'Guida in stato di alterazione accertata', -50, 'Alterazione accertata da un documento ufficiale.', 'revisione_sicurezza'),
    r('occultamento_danno', 'Violazioni gravi', 'Occultamento intenzionale di un danno accertato', -10, 'Aggiuntivo alla detrazione del danno.'),
    r('frode', 'Violazioni gravi', 'Frode o documenti falsificati accertati', 0, '0/100 e blocco di sicurezza, nessuna risalita automatica.', 'blocco_sicurezza'),
    r('furto', 'Violazioni gravi', 'Furto o appropriazione del mezzo accertati', 0, '0/100 e blocco di sicurezza, nessuna risalita automatica.', 'blocco_sicurezza'),

    r('insoluto', 'Debiti', 'Importo verificato, scaduto e non pagato', 0, "0/100 e blocco per insoluto finche' esiste un saldo scaduto. Dopo il saldo: punteggio storico meno le penalita' dell'evento e -10, massimo 40."),
    r('addebito_contestato', 'Debiti', 'Addebito contestato e ancora da verificare', 0, "Revisione umana, nessun azzeramento automatico.", 'revisione_umana'),

    r('non_previsto', 'Altro', 'Evento non previsto dalle regole', 0, 'Revisione umana, nessun punteggio inventato.', 'revisione_umana'),
]

const PER_ID = new Map(REGOLE_SCORE.map(x => [x.id, x]))
export const regolaScore = (id: CategoriaScore): RegolaScore => PER_ID.get(id)!
export const categoriaScoreValida = (v: unknown): v is CategoriaScore => typeof v === 'string' && PER_ID.has(v as CategoriaScore)

/* ---------- scaglioni ---------- */

/** Ritardo alla riconsegna in minuti. Oltre 24 ore: verifica immediata. */
export function puntiRitardoRiconsegna(minuti: number): { punti: number; scaglione: string; verificaImmediata: boolean } {
    if (minuti <= 30) return { punti: 0, scaglione: 'fino a 30 minuti', verificaImmediata: false }
    if (minuti <= 120) return { punti: -1, scaglione: 'oltre 30 minuti e fino a 2 ore', verificaImmediata: false }
    if (minuti <= 360) return { punti: -2, scaglione: 'oltre 2 e fino a 6 ore', verificaImmediata: false }
    if (minuti <= 1440) return { punti: -10, scaglione: 'oltre 6 e fino a 24 ore', verificaImmediata: false }
    return { punti: -30, scaglione: 'oltre 24 ore senza autorizzazione', verificaImmediata: true }
}

/**
 * Pagamento saldato dopo la scadenza. Oltre 7 giorni non e' una detrazione
 * a parte: e' un insoluto saldato (il motore applica il rientro), cosi' la
 * detrazione ordinaria non si somma a quella dell'insoluto.
 */
export function puntiPagamentoTardivo(giorni: number): { punti: number; scaglione: string; insoluto: boolean } {
    if (giorni <= 0) return { punti: 0, scaglione: 'entro la scadenza', insoluto: false }
    if (giorni <= 2) return { punti: -1, scaglione: 'fino a 2 giorni', insoluto: false }
    if (giorni <= 7) return { punti: -2, scaglione: 'oltre 2 e fino a 7 giorni', insoluto: false }
    return { punti: -DETRAZIONE_INSOLUTO, scaglione: 'oltre 7 giorni', insoluto: true }
}

/** Danno attribuibile al cliente, sul costo documentato totale dell'incidente. */
export function puntiDanno(importo: number): { punti: number; scaglione: string } {
    if (importo <= 300) return { punti: -5, scaglione: 'fino a 300 EUR' }
    if (importo <= 1000) return { punti: -10, scaglione: 'oltre 300 e fino a 1.000 EUR' }
    if (importo <= 3000) return { punti: -20, scaglione: 'oltre 1.000 e fino a 3.000 EUR' }
    if (importo <= 10000) return { punti: -35, scaglione: 'oltre 3.000 e fino a 10.000 EUR' }
    return { punti: -50, scaglione: 'oltre 10.000 EUR' }
}

/** Elenco per il prompt dell'AI: id e descrizione, nient'altro. */
export function categorieScorePerPrompt(): string {
    return REGOLE_SCORE.map(x => `- ${x.id}: ${x.label}. ${x.descrizione}`).join('\n')
}
