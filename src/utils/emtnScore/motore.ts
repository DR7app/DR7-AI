/**
 * EMTN Score — fasi 2-6: risk features, motore, regole critiche, confidence,
 * trend e spiegazione. Funzioni pure: stessi dati => stesso risultato.
 *
 * 01/10/2026 (direzione, "Customer Trust & Risk Scoring"): lo score pesa
 * il contesto di ogni evento, non solo cosa e' successo:
 *  - gravita' = famiglia + entita' economica (scala logaritmica: 200 EUR e
 *    30.000 EUR non pesano uguale) + gravita' indicata dall'operatore;
 *  - comportamento = pagato/parziale/aperto, velocita' del saldo,
 *    dichiarazione spontanea o omissione, contestazione respinta/accolta,
 *    responsabilita';
 *  - tempo = l'impatto si dimezza con un'emivita che cresce con la gravita';
 *    gli eventi gravissimi e le pendenze aperte non si attenuano;
 *  - recidiva NON lineare per famiglia + frequenza sui noleggi;
 *  - storico positivo = noleggi conclusi regolarmente (piu' peso se recenti,
 *    su veicoli di fascia alta, o successivi all'ultimo evento: recovery).
 * Score = 100 * (A + P) / (A + B + P + K * R): un cliente nuovo parte da 70
 * ("profilo in costruzione"), non da 100. Le regole critiche (solo fatti
 * accertati) limitano il massimo e chiedono revisione manuale.
 *
 * Cambiare un parametro = nuova VERSIONE_ALGORITMO: ogni ricalcolo salvato
 * dice con quale versione e' stato fatto.
 */
import { type EventoNormalizzato, type Famiglia, type NoleggioNormalizzato } from './normalizza'

export const VERSIONE_ALGORITMO = 'emtn-score-1.1.0'

/* ---------- parametri v1 ---------- */

/** Gravita' di partenza della famiglia (0-1), prima del contesto. */
const GRAVITA_BASE: Record<Famiglia, number> = {
    furto: 1, frode: 1, falsificazione: 0.9, mancata_restituzione: 0.9, recupero_veicolo: 0.6,
    chargeback: 0.45, guida_non_autorizzata: 0.35, insoluto: 0.35, violazione_contratto: 0.25,
    danno: 0.18, fumo: 0.15, ritardo: 0.1, penale: 0.1, multa: 0.08, animali: 0.08,
    cauzione: 0.08, pulizia: 0.06, carburante: 0.05, documentazione: 0.05, km: 0.02,
    contestazione: 0.05, regolarizzazione: 0,
}
/** Quanto l'importo sposta la gravita' (famiglie economiche contano di piu'). */
const PESO_ECONOMICO: Partial<Record<Famiglia, number>> = {
    danno: 0.7, insoluto: 0.6, chargeback: 0.5, recupero_veicolo: 0.4, furto: 0.5,
    // Km e carburante pagati sono soprattutto uso del veicolo, non condotta.
    km: 0.1, carburante: 0.15,
}
const PESO_ECONOMICO_DEFAULT = 0.3
const IMPORTO_MASSIMO_SCALA = 30_000

const PRIOR_A = 7 // evidenza positiva iniziale
const PRIOR_B = 3 // evidenza negativa iniziale -> cliente nuovo = 70
const K_RISCHIO = 10
const EMIVITA_POSITIVO_MESI = 36

export const TETTO_CON_EVENTI = 95

/* ---------- helpers ---------- */

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const mesiTra = (da: string | null, oggi: Date): number => {
    if (!da) return 0
    const t = Date.parse(da)
    if (!Number.isFinite(t)) return 0
    return Math.max(0, (oggi.getTime() - t) / (30.44 * 86_400_000))
}
/** 0-1, logaritmico: 50 EUR ~0.07, 200 ~0.19, 1.000 ~0.42, 13.000 ~0.85, 30.000 = 1. */
export function scalaEconomica(importo: number): number {
    if (!(importo > 0)) return 0
    return clamp(Math.log10(1 + importo / 100) / Math.log10(1 + IMPORTO_MASSIMO_SCALA / 100))
}
const euro = (n: number) => `${Math.round(n).toLocaleString('it-IT')} EUR`
const meseAnno = (d: string | null) => {
    if (!d) return 'data non nota'
    const t = new Date(d)
    if (!Number.isFinite(t.getTime())) return 'data non nota'
    return t.toLocaleDateString('it-IT', { month: 'short', year: 'numeric', timeZone: 'Europe/Rome' })
}

export const NOMI_FAMIGLIA: Record<Famiglia, string> = {
    danno: 'Danno', carburante: 'Carburante mancante', pulizia: 'Pulizia straordinaria', fumo: 'Fumo nel veicolo',
    animali: 'Animali nel veicolo', ritardo: 'Ritardo nella riconsegna', km: 'Chilometri eccedenti', multa: 'Multa',
    penale: 'Penale', insoluto: 'Insoluto', chargeback: 'Chargeback', contestazione: 'Contestazione',
    guida_non_autorizzata: 'Conducente non autorizzato', violazione_contratto: 'Violazione contrattuale',
    documentazione: 'Documentazione', cauzione: 'Cauzione', recupero_veicolo: 'Recupero del veicolo',
    mancata_restituzione: 'Mancata restituzione', furto: 'Furto/appropriazione', frode: 'Frode',
    falsificazione: 'Falsificazione documentale', regolarizzazione: 'Regolarizzazione',
}

/* ---------- fase 2: risk features per evento ---------- */

export interface ContributoEvento {
    evento: EventoNormalizzato
    gravita: number
    comportamento: number
    decadimento: number
    recidiva: number
    esposizione: number
    /** Massa di rischio dell'evento (prima della frequenza). */
    rischio: number
    motivi: string[]
}

/** Evento che entra nel calcolo: documentato, deciso, non una regolarizzazione. */
export function eventoConta(e: EventoNormalizzato): boolean {
    return e.verificato && !e.inRevisione && e.famiglia !== 'regolarizzazione' && e.contestazione !== 'accolta'
        && e.responsabilita !== 'non_attribuibile'
}

export function gravitaEvento(e: EventoNormalizzato): number {
    const base = GRAVITA_BASE[e.famiglia]
    const peso = PESO_ECONOMICO[e.famiglia] ?? PESO_ECONOMICO_DEFAULT
    let g = base + (1 - base) * scalaEconomica(e.importo) * peso
    // Importo grande rispetto al valore del veicolo affidato: piu' grave.
    if (e.prezzoGiornoVeicolo && e.prezzoGiornoVeicolo > 0 && e.importo > 0) {
        const giorni = e.importo / e.prezzoGiornoVeicolo
        if (giorni >= 20) g += 0.05
    }
    if (e.gravitaIndicata === 'lieve') g *= 0.7
    if (e.gravitaIndicata === 'grave') g = Math.max(g, 0.6)
    return clamp(g)
}

function emivitaMesi(g: number): number {
    if (g >= 0.8) return Infinity
    if (g >= 0.5) return 48
    if (g >= 0.2) return 24
    return 12
}

function contributiEventi(eventi: EventoNormalizzato[], oggi: Date): ContributoEvento[] {
    const validi = eventi.filter(eventoConta)
        .filter(e => !e.data || Date.parse(e.data) <= oggi.getTime())
        .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')))
    // Recidiva per INCIDENTE: piu' voci della stessa prenotazione (es. due
    // danni sullo stesso rientro) sono un solo episodio, non una ripetizione.
    const visti = new Map<Famiglia, string[]>()
    return validi.map(e => {
        const motivi: string[] = []
        const g = gravitaEvento(e)
        let m = 1
        if (e.statoPagamento === 'aperto') { m *= 3; motivi.push('non saldato') }
        else if (e.statoPagamento === 'parziale') { m *= 2; motivi.push('saldato in parte') }
        else if (e.statoPagamento === 'pagato') {
            if (e.giorniAlSaldo != null && e.giorniAlSaldo <= 7) { m *= 0.6; motivi.push('saldato subito') }
            else if (e.giorniAlSaldo != null && e.giorniAlSaldo <= 30) { m *= 0.8; motivi.push('saldato') }
            else if (e.giorniAlSaldo != null) { m *= 1; motivi.push(`saldato dopo ${e.giorniAlSaldo} giorni`) }
            else { m *= 0.8; motivi.push('saldato') }
        }
        if (e.dichiaratoDalCliente === true) { m *= 0.7; motivi.push('dichiarato dal cliente') }
        if (e.dichiaratoDalCliente === false) { m *= 1.5; motivi.push('non dichiarato dal cliente') }
        if (e.contestazione === 'respinta') { m *= 1.3; motivi.push('contestazione respinta') }
        if (e.contestazione === 'aperta') { m *= 0.8; motivi.push('contestazione in corso') }
        // Le pendenze aperte non si attenuano col tempo.
        const dec = e.statoPagamento === 'aperto' || e.statoPagamento === 'parziale'
            ? 1
            : Math.pow(0.5, mesiTra(e.data, oggi) / emivitaMesi(g))
        // Recidiva non lineare per famiglia: 1, 1.75, 2.8, 4.15...
        const incidente = e.bookingId || e.id
        const lista = visti.get(e.famiglia) || []
        if (!lista.includes(incidente)) lista.push(incidente)
        visti.set(e.famiglia, lista)
        const k = lista.indexOf(incidente)
        // Fatti lievi (km, carburante...): la ripetizione pesa, ma con un tetto.
        const rec = Math.min(g < 0.2 ? 2.5 : 5, 1 + 0.6 * k + 0.15 * k * k)
        if (k > 0) motivi.push(`recidiva (${k + 1}a volta)`)
        const esposizione = e.statoPagamento === 'aperto' || e.statoPagamento === 'parziale'
            ? 0.5 * scalaEconomica(e.residuo) : 0
        return {
            evento: e, gravita: g, comportamento: m, decadimento: dec, recidiva: rec, esposizione,
            // g * (1 + g): un fatto grave pesa piu' che in proporzione, anche se pagato.
            rischio: g * (1 + g) * m * dec * rec + esposizione, motivi,
        }
    })
}

/* ---------- fase 3-4: motore + regole critiche ---------- */

export interface FlagCritico {
    codice: 'furto' | 'frode' | 'falsificazione' | 'mancata_restituzione' | 'recupero_veicolo' | 'insoluto_grave_danni' | 'override'
    label: string
    /** Score massimo consentito dal flag. */
    tetto: number
    eventoId: string | null
}

export type LivelloRischio = 'Very Low' | 'Low' | 'Moderate' | 'High' | 'Critical'
export type Trend = 'Improving' | 'Stable' | 'Deteriorating'

export interface OverrideScore {
    tipo: 'limite_massimo' | 'score_fisso' | 'flag_critico'
    valore: number | null
    motivo: string
    operatore: string | null
    creato_il: string
}

export interface RisultatoEMTNScore {
    versione: string
    score: number
    /** Score del motore prima di flag e override. */
    scoreCalcolato: number
    confidence: number
    livello: LivelloRischio
    band: 'green' | 'yellow' | 'red'
    level: 1 | 2 | 3
    trend: Trend
    scorePrecedente6Mesi: number | null
    profiloInCostruzione: boolean
    revisioneManuale: boolean
    flag: FlagCritico[]
    positivi: string[]
    rischi: string[]
    spiegazione: string
    override: OverrideScore | null
    dettaglio: {
        noleggiConclusi: number
        noleggiRegolari: number
        evidenzaPositiva: number
        rischioTotale: number
        frequenza: number
        eventiConsiderati: number
        eventiInRevisione: number
        nonSaldati: number
        residuo: number
        contributi: Array<{ id: string; famiglia: Famiglia; label: string; data: string | null; rischio: number; motivi: string[] }>
    }
}

function flagCritici(eventi: EventoNormalizzato[]): FlagCritico[] {
    const out: FlagCritico[] = []
    for (const e of eventi) {
        if (!e.verificato || e.inRevisione || e.contestazione === 'accolta') continue
        if (e.famiglia === 'furto' && e.accertato) out.push({ codice: 'furto', label: 'Furto/appropriazione accertata', tetto: 0, eventoId: e.id })
        if (e.famiglia === 'frode' && e.accertato) out.push({ codice: 'frode', label: 'Frode accertata', tetto: 0, eventoId: e.id })
        if (e.famiglia === 'falsificazione' && e.accertato) out.push({ codice: 'falsificazione', label: 'Falsificazione documentale accertata', tetto: 5, eventoId: e.id })
        if (e.famiglia === 'mancata_restituzione') {
            out.push(e.veicoloRestituito
                ? { codice: 'mancata_restituzione', label: 'Mancata restituzione (veicolo poi riconsegnato)', tetto: 30, eventoId: e.id }
                : { codice: 'mancata_restituzione', label: 'Mancata restituzione del veicolo', tetto: 10, eventoId: e.id })
        }
        if (e.famiglia === 'recupero_veicolo') out.push({ codice: 'recupero_veicolo', label: "Recupero del veicolo da parte dell'operatore", tetto: 40, eventoId: e.id })
        if (e.famiglia === 'danno' && e.statoPagamento !== 'pagato' && e.residuo >= 2000) {
            out.push({ codice: 'insoluto_grave_danni', label: `Danno non saldato: ${euro(e.residuo)} di residuo`, tetto: 30, eventoId: e.id })
        }
    }
    return out
}

const ORDINE_LIVELLI: LivelloRischio[] = ['Very Low', 'Low', 'Moderate', 'High', 'Critical']

/** Pendenze aperte: mai verde (almeno Moderate); danno aperto almeno High. */
function livelloDa(score: number, flag: FlagCritico[], minimo: LivelloRischio): LivelloRischio {
    let l: LivelloRischio = 'Very Low'
    if (flag.some(f => f.tetto <= 30) || score < 40) l = 'Critical'
    else if (score < 60) l = 'High'
    else if (score < 75) l = 'Moderate'
    else if (score < 90) l = 'Low'
    return ORDINE_LIVELLI.indexOf(l) >= ORDINE_LIVELLI.indexOf(minimo) ? l : minimo
}

function evidenzaPositiva(noleggi: NoleggioNormalizzato[], ultimoEvento: string | null, oggi: Date): number {
    let p = 0
    for (const n of noleggi) {
        if (!n.concluso || !n.regolare) continue
        if (n.data && Date.parse(n.data) > oggi.getTime()) continue
        let w = Math.pow(0.5, mesiTra(n.data, oggi) / EMIVITA_POSITIVO_MESI)
        if (n.prezzoGiorno != null && n.prezzoGiorno >= 300) w *= 1.3
        else if (n.prezzoGiorno != null && n.prezzoGiorno >= 150) w *= 1.15
        // Recovery: i noleggi regolari dopo l'ultimo evento valgono di piu'.
        if (ultimoEvento && n.data && n.data > ultimoEvento) w *= 1.2
        p += w
    }
    return p
}

function confidenceDa(noleggi: NoleggioNormalizzato[], eventi: EventoNormalizzato[], identificato: boolean, oggi: Date): number {
    const conclusi = noleggi.filter(n => n.concluso && (!n.data || Date.parse(n.data) <= oggi.getTime()))
    const n = conclusi.length
    const date = conclusi.map(x => x.data).filter(Boolean).sort() as string[]
    const anzianita = date.length ? mesiTra(date[0], oggi) : 0
    const considerati = eventi.filter(eventoConta)
    const noti = considerati.filter(e => e.statoPagamento !== 'non_applicabile' && e.data).length
    const qualita = considerati.length ? noti / considerati.length : 1
    const c = (identificato ? 0.1 : 0.05)
        + 0.7 * (1 - Math.exp(-n / 12))
        + 0.1 * clamp(anzianita / 24)
        + 0.1 * qualita
    return Math.round(clamp(c, 0, 0.97) * 100)
}

interface Calcolo {
    scoreCalcolato: number
    contributi: ContributoEvento[]
    P: number
    R: number
    frequenza: number
    noleggiConclusi: number
    noleggiRegolari: number
}

function calcolaGrezzo(eventi: EventoNormalizzato[], noleggi: NoleggioNormalizzato[], oggi: Date): Calcolo {
    const contributi = contributiEventi(eventi, oggi)
    const conclusi = noleggi.filter(n => n.concluso && (!n.data || Date.parse(n.data) <= oggi.getTime()))
    const regolari = conclusi.filter(n => n.regolare)
    const ultimo = contributi.map(c => c.evento.data).filter(Boolean).sort().pop() || null
    const P = evidenzaPositiva(noleggi, ultimo, oggi)
    // Frequenza: episodi (prenotazioni distinte) su noleggi, con 3 noleggi
    // "neutri" in piu' perche' 1 evento su 1 noleggio non dica 100%; oltre
    // il 10% il rischio cresce.
    // Contano solo gli episodi non lievi (gravita' >= 0.15).
    const episodi = new Set(contributi.filter(c => c.gravita >= 0.15).map(c => c.evento.bookingId || c.evento.id)).size
    const frequenza = episodi / (conclusi.length + 3)
    const fattoreFrequenza = 1 + clamp(frequenza - 0.1, 0, 1) * 1.5
    const R = contributi.reduce((t, c) => t + c.rischio, 0) * fattoreFrequenza
    let score = 100 * (PRIOR_A + P) / (PRIOR_A + PRIOR_B + P + K_RISCHIO * R)
    if (contributi.length > 0) score = Math.min(score, TETTO_CON_EVENTI)
    return {
        scoreCalcolato: Math.round(clamp(score, 0, 100)),
        contributi, P, R, frequenza,
        noleggiConclusi: conclusi.length, noleggiRegolari: regolari.length,
    }
}

/* ---------- fase 5-6: spiegazione deterministica ---------- */

function descriviEvento(c: ContributoEvento): string {
    const e = c.evento
    const nome = e.famiglia === 'penale' || e.famiglia === 'danno' ? e.label : NOMI_FAMIGLIA[e.famiglia]
    const importo = e.importo > 0 ? ` ${euro(e.importo)}` : ''
    const quando = e.data ? ` (${meseAnno(e.data)})` : ''
    const come = c.motivi.length ? `: ${c.motivi.join(', ')}` : ''
    return `${nome}${importo}${quando}${come}`
}

export interface InputScore {
    eventi: EventoNormalizzato[]
    noleggi: NoleggioNormalizzato[]
    /** Cliente riconosciuto con codice fiscale/scheda. */
    identificato: boolean
    override?: OverrideScore | null
    oggi?: Date
}

export function calcolaEMTNScore(input: InputScore): RisultatoEMTNScore {
    const oggi = input.oggi || new Date()
    const base = calcolaGrezzo(input.eventi, input.noleggi, oggi)
    const flag = flagCritici(input.eventi)
    const override = input.override || null
    if (override?.tipo === 'flag_critico') {
        flag.push({ codice: 'override', label: `Flag della direzione: ${override.motivo}`, tetto: override.valore ?? 0, eventoId: null })
    }

    let score = base.scoreCalcolato
    for (const f of flag) score = Math.min(score, f.tetto)
    if (override?.tipo === 'limite_massimo' && override.valore != null) score = Math.min(score, override.valore)
    if (override?.tipo === 'score_fisso' && override.valore != null) score = override.valore
    score = Math.round(clamp(score, 0, 100))

    const confidence = confidenceDa(input.noleggi, input.eventi, input.identificato, oggi)
    const profiloInCostruzione = base.noleggiConclusi < 3 || confidence < 35
    const aperti = base.contributi.filter(c => c.evento.statoPagamento === 'aperto' || c.evento.statoPagamento === 'parziale')
    const minimo: LivelloRischio = aperti.some(c => c.evento.famiglia === 'danno') ? 'High' : aperti.length > 0 ? 'Moderate' : 'Very Low'
    const livello = livelloDa(score, flag, minimo)
    const band: RisultatoEMTNScore['band'] = livello === 'Very Low' || livello === 'Low' ? 'green' : livello === 'Moderate' ? 'yellow' : 'red'
    const level = band === 'green' ? 1 : band === 'yellow' ? 2 : 3

    // Trend: stesso calcolo con i soli dati di 6 mesi fa.
    const seiMesiFa = new Date(oggi.getTime() - 182 * 86_400_000)
    const haStoria = input.noleggi.some(n => n.data && Date.parse(n.data) <= seiMesiFa.getTime())
        || input.eventi.some(e => e.data && Date.parse(e.data) <= seiMesiFa.getTime())
    let scorePrecedente6Mesi: number | null = null
    let trend: Trend = 'Stable'
    if (haStoria) {
        const prima = calcolaGrezzo(input.eventi, input.noleggi, seiMesiFa)
        let s = prima.scoreCalcolato
        for (const f of flagCritici(input.eventi.filter(e => !e.data || Date.parse(e.data) <= seiMesiFa.getTime()))) s = Math.min(s, f.tetto)
        scorePrecedente6Mesi = s
        const delta = base.scoreCalcolato - s
        trend = delta >= 3 ? 'Improving' : delta <= -3 ? 'Deteriorating' : 'Stable'
    }

    const nonSaldati = aperti
    const residuo = nonSaldati.reduce((t, c) => t + Math.max(0, c.evento.residuo), 0)
    const inRevisione = input.eventi.filter(e => e.inRevisione).length

    // Fattori positivi (max 3), in ordine fisso di priorita'.
    const positivi: string[] = []
    if (base.noleggiRegolari > 0) positivi.push(`${base.noleggiRegolari} noleggi conclusi senza problemi`)
    if (base.contributi.length > 0 && nonSaldati.length === 0) positivi.push('Tutti gli importi dovuti risultano saldati')
    const ultimoEvento = base.contributi.map(c => c.evento.data).filter(Boolean).sort().pop() || null
    if (base.contributi.length === 0 && base.noleggiConclusi > 0) positivi.push('Nessun evento negativo registrato')
    else if (ultimoEvento && mesiTra(ultimoEvento, oggi) >= 12) positivi.push(`Nessun evento negativo da ${Math.floor(mesiTra(ultimoEvento, oggi))} mesi`)
    const dichiarati = base.contributi.filter(c => c.evento.dichiaratoDalCliente === true).length
    if (dichiarati > 0) positivi.push(`${dichiarati} eventi dichiarati spontaneamente dal cliente`)
    const conclusiDate = input.noleggi.filter(n => n.concluso && n.data).map(n => n.data as string).sort()
    if (conclusiDate.length && mesiTra(conclusiDate[0], oggi) >= 12) positivi.push(`Cliente dal ${meseAnno(conclusiDate[0])}`)

    // Fattori di rischio (max 3): gli eventi che pesano di piu'.
    const rischi: string[] = []
    for (const f of flag) rischi.push(f.label)
    const perFamiglia = new Map<Famiglia, ContributoEvento[]>()
    for (const c of base.contributi) perFamiglia.set(c.evento.famiglia, [...(perFamiglia.get(c.evento.famiglia) || []), c])
    const ordinati = [...base.contributi].sort((a, b) => b.rischio - a.rischio)
    const giaDetti = new Set<Famiglia>()
    for (const c of ordinati) {
        if (rischi.length >= 3) break
        const stessi = perFamiglia.get(c.evento.famiglia) || []
        if (stessi.length >= 2) {
            if (giaDetti.has(c.evento.famiglia)) continue
            giaDetti.add(c.evento.famiglia)
            rischi.push(`${NOMI_FAMIGLIA[c.evento.famiglia]}: ${stessi.length} volte (recidiva)`)
        } else {
            rischi.push(descriviEvento(c))
        }
    }
    if (rischi.length < 3 && residuo > 0) rischi.push(`Esposizione aperta: ${euro(residuo)}`)
    if (rischi.length < 3 && inRevisione > 0) rischi.push(`${inRevisione} segnalazioni in revisione (non pesano finche' non decise)`)

    // Spiegazione: frasi fisse costruite dai numeri.
    const frasi: string[] = []
    if (profiloInCostruzione) frasi.push(`Profilo in costruzione: ${base.noleggiConclusi} noleggi conclusi, dati insufficienti per un giudizio solido.`)
    else frasi.push(`${base.noleggiConclusi} noleggi conclusi, di cui ${base.noleggiRegolari} senza problemi.`)
    if (base.contributi.length === 0) frasi.push('Nessun evento negativo documentato.')
    else {
        frasi.push(`${base.contributi.length} eventi documentati considerati${nonSaldati.length ? `, ${nonSaldati.length} non saldati (${euro(residuo)})` : ', tutti saldati'}.`)
        if (base.frequenza > 0.1) frasi.push(`Frequenza elevata: ${Math.round(base.frequenza * 100)}% dei noleggi con un evento.`)
    }
    if (flag.length) frasi.push(`Flag critici: lo score non puo' superare ${Math.min(...flag.map(f => f.tetto))}; serve revisione manuale.`)
    if (override) frasi.push(`Intervento manuale della direzione: ${override.motivo}.`)
    if (trend !== 'Stable' && scorePrecedente6Mesi != null) frasi.push(`Sei mesi fa lo score era ${scorePrecedente6Mesi}.`)

    return {
        versione: VERSIONE_ALGORITMO,
        score,
        scoreCalcolato: base.scoreCalcolato,
        confidence,
        livello, band, level, trend, scorePrecedente6Mesi,
        profiloInCostruzione,
        revisioneManuale: flag.length > 0,
        flag,
        positivi: positivi.slice(0, 3),
        rischi: rischi.slice(0, 3),
        spiegazione: frasi.join(' '),
        override,
        dettaglio: {
            noleggiConclusi: base.noleggiConclusi,
            noleggiRegolari: base.noleggiRegolari,
            evidenzaPositiva: Math.round(base.P * 100) / 100,
            rischioTotale: Math.round(base.R * 1000) / 1000,
            frequenza: Math.round(base.frequenza * 1000) / 1000,
            eventiConsiderati: base.contributi.length,
            eventiInRevisione: inRevisione,
            nonSaldati: nonSaldati.length,
            residuo: Math.round(residuo * 100) / 100,
            contributi: base.contributi.map(c => ({
                id: c.evento.id, famiglia: c.evento.famiglia, label: c.evento.label, data: c.evento.data,
                rischio: Math.round(c.rischio * 1000) / 1000, motivi: c.motivi,
            })),
        },
    }
}
