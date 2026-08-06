import { supabase } from '../supabaseClient'

/**
 * Pause obbligatorie da contratto (operatore_contratto.pause_config).
 *
 * 2026-08-02 (#32 bug ricorrente): la pausa fissa configurata dalla direzione
 * NON compariva "in automatico ogni giorno" agli operatori. Tre cause:
 *
 *   1. RLS. operatore_contratto e' leggibile per intero solo da
 *      valerio@/ilenia@/ophe@; per tutti gli altri la SELECT non fallisce,
 *      torna una lista VUOTA. Le pause fisse sparivano quindi in silenzio a
 *      seconda di chi era loggato. Adesso si passa dalla RPC SECURITY DEFINER
 *      operatore_pause_config_attive() (vedi migration
 *      20260802_pause_config_lettura_condivisa.sql) che espone SOLO
 *      operatore_id + pause_config, mai i dati di compenso.
 *   2. Ogni vista reimplementava il calcolo a modo suo (e tre non lo facevano
 *      affatto). Qui c'e' l'unica implementazione: la usano Rilevazione Orari,
 *      Report Operatori, profilo operatore, buste paga e i due editor "I miei
 *      orari".
 *   3. La pausa era solo un numero di minuti: le colonne Inizio/Fine Pausa
 *      restavano vuote e sembrava che non fosse stata messa nessuna pausa.
 *      finestrePausaVirtuali() materializza le fasce come finestre vere.
 *
 * Semantica (quella fissata dal commit c8f57f1d del 2026-08-02):
 *   - minuti obbligatori = durata_min + somma delle fasce orarie
 *   - la pausa si MOSTRA sempre, anche se pagata e anche prima della timbratura
 *   - si SCALA dalle ore solo se non pagata, prendendo il MAX tra pausa
 *     timbrata e pausa obbligatoria
 *   - pagata = true -> nessun pre-riempimento nei due editor: salvata come
 *     pausa vera verrebbe scalata dalle ore, che e' esattamente il contrario
 *   - giorni = [] -> vale tutti i giorni; altrimenti solo i giorni elencati
 *     (0 = Domenica … 6 = Sabato, stessa numerazione di Date.getDay())
 */

const ROME_TZ = 'Europe/Rome'

export interface PauseFascia { da?: string; a?: string }

export interface PauseConfig {
    durata_min?: number
    pagata?: boolean
    fasce?: PauseFascia[]
    giorni?: number[]
    /**
     * Data (YYYY-MM-DD, Europe/Rome) da cui la pausa di contratto ENTRA in
     * vigore. I giorni PRECEDENTI non hanno alcuna pausa obbligatoria (utile
     * quando un operatore ha lavorato senza pause prima che la regola partisse).
     * Vuoto/assente = vale da sempre. 2026-08-06: Salvatore -> decorrenza
     * 2026-07-15 (1-14 luglio ha lavorato al posto delle pause).
     */
    decorrenza?: string
}

export interface FasciaRisolta { da: string; a: string; minuti: number }

export interface PausaObbligatoria {
    /** Minuti configurati per quel giorno: quello che si MOSTRA, anche se pagata. */
    minuti: number
    /** Minuti che si DEDUCONO dalle ore lavorate: 0 se la pausa e' pagata. */
    minutiDaScalare: number
    /** Fasce orarie valide di quel giorno, gia' normalizzate a HH:MM. */
    fasce: FasciaRisolta[]
    /** true = pausa pagata, non va scalata dalle ore. */
    pagata: boolean
    /** true = esiste una configurazione che vale per quel giorno. */
    vale: boolean
}

export const PAUSA_NON_CONFIGURATA: PausaObbligatoria = { minuti: 0, minutiDaScalare: 0, fasce: [], pagata: false, vale: false }

/** "13:00" -> 780. Torna null se non e' un orario HH:MM valido. */
export function hhmmToMinuti(hhmm: unknown): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
    if (!match) return null
    const h = Number(match[1])
    const m = Number(match[2])
    if (h > 23 || m > 59) return null
    return h * 60 + m
}

/** 780 -> "13:00" (formato europeo 24h, mai AM/PM). */
export function minutiToHHMM(minuti: number): string {
    const tot = Math.max(0, Math.round(minuti)) % 1440
    return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
}

/**
 * Giorno della settimana di una data YYYY-MM-DD (0 = Dom … 6 = Sab).
 * Mezzogiorno per non farsi spostare il giorno dal fuso. -1 se data non valida.
 */
export function dowDelGiorno(dataISO: string): number {
    const d = new Date(`${dataISO}T12:00:00`)
    return Number.isNaN(d.getTime()) ? -1 : d.getDay()
}

/** JSONB grezzo dal DB -> PauseConfig tipizzata. null se non c'e' nulla di utile. */
export function normalizzaPauseConfig(raw: unknown): PauseConfig | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const o = raw as Record<string, unknown>
    const fasce: PauseFascia[] = Array.isArray(o.fasce)
        ? (o.fasce as unknown[])
            .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
            .map(f => ({ da: String(f.da ?? ''), a: String(f.a ?? '') }))
        : []
    const giorni: number[] = Array.isArray(o.giorni)
        ? (o.giorni as unknown[]).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
        : []
    const decorrenzaRaw = String(o.decorrenza ?? '').trim()
    const decorrenza = /^\d{4}-\d{2}-\d{2}$/.test(decorrenzaRaw) ? decorrenzaRaw : undefined
    return {
        durata_min: Number(o.durata_min) || 0,
        pagata: o.pagata === true,
        fasce,
        giorni,
        decorrenza,
    }
}

/**
 * Pausa obbligatoria che vale per UN giorno preciso.
 * Rispetta i giorni della settimana selezionati (vuoto = tutti).
 */
export function pausaObbligatoriaDelGiorno(cfg: PauseConfig | null | undefined, dataISO: string): PausaObbligatoria {
    if (!cfg) return PAUSA_NON_CONFIGURATA
    // Decorrenza: prima di questa data la pausa di contratto non esiste ancora.
    // Confronto lessicografico su YYYY-MM-DD (stesso formato) = confronto per data.
    if (cfg.decorrenza && /^\d{4}-\d{2}-\d{2}$/.test(dataISO) && dataISO < cfg.decorrenza) return PAUSA_NON_CONFIGURATA
    const giorni = cfg.giorni ?? []
    if (giorni.length > 0 && !giorni.includes(dowDelGiorno(dataISO))) return PAUSA_NON_CONFIGURATA

    const fasce: FasciaRisolta[] = []
    for (const f of (cfg.fasce ?? [])) {
        const da = hhmmToMinuti(f.da)
        const a = hhmmToMinuti(f.a)
        if (da == null || a == null || a <= da) continue
        fasce.push({ da: minutiToHHMM(da), a: minutiToHHMM(a), minuti: a - da })
    }
    const durata = Math.max(0, Number(cfg.durata_min) || 0)
    const totale = durata + fasce.reduce((s, f) => s + f.minuti, 0)
    if (totale <= 0) return PAUSA_NON_CONFIGURATA

    const pagata = cfg.pagata === true
    return {
        // Pagata = si mostra comunque, ma non si scala dalle ore.
        minuti: totale,
        minutiDaScalare: pagata ? 0 : totale,
        fasce,
        pagata,
        vale: true,
    }
}

/**
 * Applica la pausa obbligatoria a una giornata.
 *   - pausa mostrata  = MAX(timbrata, obbligatoria)          -> sempre visibile
 *   - pausa scalata   = MAX(timbrata, obbligatoria se non pagata)
 * Cosi' l'operatore non deve inserirla a mano e le pause pagate non gli
 * mangiano le ore.
 */
// 2026-08-03 (#32): la pausa del contratto e' solo il DEFAULT. Se quel giorno
// c'e' una pausa registrata/modificata a mano (timbrata > 0) vale QUELLA, la
// realta'; l'obbligatoria copre solo i giorni SENZA nessuna pausa a mano.
// Prima si faceva MAX(timbrata, obbligatoria): imponeva l'obbligatoria anche
// quando l'operatore aveva gia' registrato le sue pause vere (es. 2h12 timbrate
// venivano portate a 2h40 di contratto). Queste due funzioni sono l'unica
// fonte della regola: usarle ovunque per non farla divergere tra le viste.

/** Pausa da MOSTRARE: se c'e' pausa a mano quel giorno vale quella, altrimenti l'obbligatoria. */
export function pausaMostrataMin(timbrataMin: number, pausa: PausaObbligatoria): number {
    return Math.max(0, timbrataMin) > 0 ? Math.max(0, timbrataMin) : pausa.minuti
}

/** Pausa da SCALARE dalle ore: pausa a mano se c'e', altrimenti l'obbligatoria non pagata. */
export function pausaScalataMin(timbrataMin: number, pausa: PausaObbligatoria): number {
    return Math.max(0, timbrataMin) > 0 ? Math.max(0, timbrataMin) : pausa.minutiDaScalare
}

export function applicaPausaObbligatoria(args: {
    /** Minuti entrata->uscita, PRIMA di togliere qualsiasi pausa. */
    minutiLordi: number
    minutiPausaTimbrata: number
    pausa: PausaObbligatoria
}): { minutiPausa: number; minutiLavorati: number; daContratto: boolean } {
    const timbrata = Math.max(0, args.minutiPausaTimbrata)
    const minutiPausa = pausaMostrataMin(timbrata, args.pausa)
    const scalati = pausaScalataMin(timbrata, args.pausa)
    return {
        minutiPausa,
        minutiLavorati: Math.max(0, args.minutiLordi - scalati),
        // "da contratto" solo quando NON c'e' pausa a mano e l'obbligatoria vale.
        daContratto: timbrata === 0 && args.pausa.minuti > 0,
    }
}

/** Minuti-del-giorno (0..1439) in Europe/Rome di un istante ISO. -1 se invalido. */
export function isoToRomeMinuti(iso: string): number {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return -1
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d)
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? NaN)
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? NaN)
    if (Number.isNaN(h) || Number.isNaN(m)) return -1
    return h * 60 + m
}

export interface FinestraPausaISO { inizio: string; fine: string; fonte: 'timbrata' | 'contratto' }

/**
 * 2026-08-04 (#32, modello PER-FASCIA scelto dalla direzione): pause di
 * CONTRATTO e pause A MANO si combinano cosi':
 *   - una fascia di contratto viene SOSTITUITA solo dalle pause a mano che la
 *     SOVRAPPONGONO (si usano gli orari reali); le fasce non toccate RESTANO;
 *   - le pause a mano valgono sempre.
 * Cosi' l'operatore vede sia la pausa messa a mano SIA le pause del contratto,
 * e chi timbra la sua versione di una fascia (es. Salvatore) non si vede
 * sommare il doppio.
 *
 * Ritorna le finestre ISO da MOSTRARE (Inizio/Fine Pausa) + i minuti:
 *   - mostrateMin: totale pausa da mostrare
 *   - scalateMin : minuti da togliere dalle ore (pause a mano SEMPRE + contratto
 *                  non-sovrapposto solo se NON pagata)
 *   - extraContrattoMin: la sola parte di contratto oltre le pause a mano; utile
 *                  per le viste dove i minuti arrivano gia' al netto delle pause
 *                  timbrate (RPC operatore_minuti_lavorati).
 */
export function combinaPauseGiorno(
    dataISO: string,
    manualiISO: { inizio: string; fine: string }[],
    pausa: PausaObbligatoria,
): { finestre: FinestraPausaISO[]; mostrateMin: number; scalateMin: number; extraContrattoMin: number } {
    const overlap = (x: { da: number; a: number }, y: { da: number; a: number }) => x.da < y.a && y.da < x.a
    // Pause a mano -> minuti-del-giorno per il confronto di sovrapposizione.
    const man = manualiISO
        .map(w => ({ da: isoToRomeMinuti(w.inizio), a: isoToRomeMinuti(w.fine), iso: w }))
        .filter(w => w.da >= 0 && w.a > w.da)
    // Fasce di contratto -> minuti-del-giorno.
    const fasce = pausa.fasce
        .map(f => ({ da: hhmmToMinuti(f.da) ?? -1, a: hhmmToMinuti(f.a) ?? -1, hhmm: f }))
        .filter(w => w.da >= 0 && w.a > w.da)
    // Fasce NON sovrapposte da nessuna pausa a mano: restano.
    const fasceKept = fasce.filter(cw => !man.some(mw => overlap(mw, cw)))

    const manualiMin = man.reduce((s, w) => s + (w.a - w.da), 0)
    const fasceKeptMin = fasceKept.reduce((s, w) => s + (w.a - w.da), 0)
    const fasceTutteMin = fasce.reduce((s, w) => s + (w.a - w.da), 0)
    const flatDurata = Math.max(0, pausa.minuti - fasceTutteMin)      // pausa senza fascia
    const flatResidua = Math.max(0, flatDurata - manualiMin)          // parte flat non coperta a mano

    const extraContrattoMin = pausa.pagata ? 0 : (fasceKeptMin + flatResidua)
    const mostrateMin = manualiMin + fasceKeptMin + flatResidua
    const scalateMin = manualiMin + extraContrattoMin                 // le pause a mano si scalano sempre

    const finestre: FinestraPausaISO[] = man.map(w => ({ inizio: w.iso.inizio, fine: w.iso.fine, fonte: 'timbrata' as const }))
    for (const w of fasceKept) {
        const inizio = romeHHMMToISO(w.hhmm.da, dataISO)
        const fine = romeHHMMToISO(w.hhmm.a, dataISO)
        if (inizio && fine) finestre.push({ inizio, fine, fonte: 'contratto' })
    }
    finestre.sort((a, b) => new Date(a.inizio).getTime() - new Date(b.inizio).getTime())

    return { finestre, mostrateMin, scalateMin, extraContrattoMin }
}

/** "13:00" + "2026-08-02" -> ISO UTC dell'istante corrispondente a Europe/Rome. */
export function romeHHMMToISO(hhmm: string, dataISO: string): string | null {
    const minuti = hhmmToMinuti(hhmm)
    if (minuti == null) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) return null
    const [year, month, day] = dataISO.split('-').map(Number)
    // Costruisco l'istante come se HH:MM fosse UTC, poi correggo con l'offset
    // reale di Europe/Rome per quell'istante (gestisce ora legale/solare).
    const utcGuess = new Date(Date.UTC(year, month - 1, day, Math.floor(minuti / 60), minuti % 60, 0))
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: ROME_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    })
    const parts = Object.fromEntries(fmt.formatToParts(utcGuess).map(p => [p.type, p.value]))
    const romeHour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10)
    const romeAsUTC = Date.UTC(
        parseInt(parts.year, 10),
        parseInt(parts.month, 10) - 1,
        parseInt(parts.day, 10),
        romeHour,
        parseInt(parts.minute, 10),
        parseInt(parts.second, 10),
    )
    return new Date(utcGuess.getTime() - (romeAsUTC - utcGuess.getTime())).toISOString()
}

/**
 * Fasce del contratto -> finestre di pausa vere (ISO) per quel giorno, cosi'
 * le colonne "Inizio Pausa / Fine Pausa" mostrano la pausa automatica invece
 * di restare a "—". Sono finestre VIRTUALI: non vengono scritte a DB.
 */
export function finestrePausaVirtuali(pausa: PausaObbligatoria, dataISO: string): { inizio: string; fine: string }[] {
    const out: { inizio: string; fine: string }[] = []
    for (const f of pausa.fasce) {
        const inizio = romeHHMMToISO(f.da, dataISO)
        const fine = romeHHMMToISO(f.a, dataISO)
        if (inizio && fine) out.push({ inizio, fine })
    }
    return out
}

/**
 * Config pause di TUTTI i contratti attivi, per operatore.
 *
 * Passa dalla RPC SECURITY DEFINER cosi' funziona per qualunque admin loggato.
 * Se la RPC non c'e' ancora (migration non eseguita) ricade sulla lettura
 * diretta della tabella: comportamento identico a prima, mai un crash.
 */
export async function fetchPauseConfigAttive(operatoreIds?: string[]): Promise<Map<string, PauseConfig>> {
    const out = new Map<string, PauseConfig>()
    const filtro = operatoreIds && operatoreIds.length > 0 ? new Set(operatoreIds) : null
    const raccogli = (rows: unknown[]) => {
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue
            const r = row as { operatore_id?: string; pause_config?: unknown }
            if (!r.operatore_id) continue
            if (filtro && !filtro.has(r.operatore_id)) continue
            const cfg = normalizzaPauseConfig(r.pause_config)
            if (cfg) out.set(r.operatore_id, cfg)
        }
    }

    try {
        const { data, error } = await supabase.rpc('operatore_pause_config_attive')
        if (!error && Array.isArray(data)) {
            raccogli(data)
            return out
        }
    } catch { /* RPC non deployata: si prova la lettura diretta */ }

    try {
        let q = supabase
            .from('operatore_contratto')
            .select('operatore_id, pause_config')
            .eq('attivo', true)
        if (operatoreIds && operatoreIds.length > 0) q = q.in('operatore_id', operatoreIds)
        const { data, error } = await q
        if (!error && Array.isArray(data)) raccogli(data)
    } catch { /* colonna pause_config assente: nessuna pausa fissa */ }

    return out
}

/** Config pausa di UN operatore (il proprio profilo la legge sempre, via RLS self-read). */
export async function fetchPauseConfigOperatore(operatoreId: string): Promise<PauseConfig | null> {
    const map = await fetchPauseConfigAttive([operatoreId])
    return map.get(operatoreId) ?? null
}
