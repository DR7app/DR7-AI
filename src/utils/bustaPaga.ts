/**
 * 09/11/2026 — Busta paga: UNA sola fonte per lista e dettaglio.
 *
 * Segnalazione direzione (video 09/11): in Buste Paga la LISTA del periodo
 * mostrava ore ordinarie/straordinarie, paghe e totale piu' BASSI del
 * dettaglio che si apre cliccando sull'operatore. Il dettaglio era giusto,
 * la lista sbagliata, per tutti.
 *
 * Causa: la lista leggeva le timbrature di TUTTI gli operatori del periodo
 * con UNA sola richiesta. PostgREST restituisce al massimo 1000 righe: in un
 * mese intero (4-6 timbrature a giornata per ogni operatore) le righe oltre
 * la millesima, cioe' gli ULTIMI giorni del mese, sparivano per tutti, e una
 * giornata tagliata a meta' (entrata letta, uscita no) valeva zero ore.
 * Il dettaglio legge un solo operatore alla volta e restava sotto il tetto.
 * In piu' le due schermate avevano due copie dello stesso calcolo, gia'
 * divergenti nell'arrotondamento dei minuti (lista Math.round, dettaglio
 * Math.floor).
 *
 * Qui stanno: la lettura PAGINATA delle timbrature, la costruzione delle
 * giornate (pause per fascia, solo quelle mostrate contano) e il calcolo
 * della paga. Lista (PayrollPeriodoView) e dettaglio (Calcola Paga della
 * scheda operatore) usano queste funzioni e nient'altro.
 */
import { supabase } from '../supabaseClient'
import { fetchAllRows } from './fetchAllRows'
import { pausaObbligatoriaDelGiorno, combinaPauseGiorno, type PauseConfig } from './pauseObbligatorie'
import { tariffaGiornaliera, contaGiornatePagate, type FrequenzaStipendio } from './pagaGiornaliera'

export interface TimbraturaBustaPaga {
    id?: string
    operatore_id: string
    tipo: 'entrata' | 'uscita' | 'pausa_inizio' | 'pausa_fine' | string
    timestamp: string
    data: string
}

export interface GiornataBustaPaga {
    data: string
    entrata: string | null
    uscita: string | null
    pauseWindows: { start: string; end: string | null; durMin: number }[]
    minutiLavorati: number
    minutiPausa: number
}

export interface ContrattoBustaPaga {
    stipendio_mensile_eur?: number | null
    stipendio_frequenza?: FrequenzaStipendio | null
    paga_oraria_eur?: number | null
    paga_giornaliera_eur?: number | null
    paga_straordinario_eur?: number | null
    straordinario_abilitato?: boolean | null
    ore_soglia_straordinario?: number | null
    ore_target_giornaliere?: number | null
    ore_target_settimanali?: number | null
    ore_target_mensili?: number | null
}

export interface CalcoloBustaPaga {
    sogliaMin: number
    sogliaMode: 'giornaliera' | 'settimanale' | 'mensile'
    minLavorati: number
    minOrdinari: number
    minStraord: number
    pagaOrd: number
    pagaStraord: number
    correzione: number
    totale: number
    straordEnabled: boolean
    oraria: number
    oraSource: 'explicit' | 'derived' | 'none'
    straord: number
    tariffaGiorno: number
    giornatePagate: number
}

/** Tutti i giorni YYYY-MM-DD da `from` a `to` inclusi (date di calendario, senza fuso). */
export function giorniDelPeriodo(from: string, to: string): string[] {
    const out: string[] = []
    const [fy, fm, fd] = from.split('-').map(Number)
    const [ty, tm, td] = to.split('-').map(Number)
    if (!fy || !fm || !fd || !ty || !tm || !td) return out
    const cur = new Date(Date.UTC(fy, fm - 1, fd))
    const end = Date.UTC(ty, tm - 1, td)
    while (cur.getTime() <= end) {
        out.push(cur.toISOString().slice(0, 10))
        cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return out
}

/**
 * Timbrature del periodo, TUTTE: paginate a 1000 righe (tetto PostgREST).
 * Ordine stabile timestamp + id, cosi' nessuna riga salta tra una pagina e
 * l'altra. `data` e' la data Europe/Rome generata dal database.
 */
export async function caricaTimbraturePeriodo(
    from: string,
    to: string,
    operatoreIds?: string[]
): Promise<{ data: TimbraturaBustaPaga[]; error: string | null }> {
    if (operatoreIds && operatoreIds.length === 0) return { data: [], error: null }
    const res = await fetchAllRows<TimbraturaBustaPaga>((da, a) => {
        let q = supabase
            .from('timesheet_entries')
            .select('id, operatore_id, tipo, timestamp, data')
            .gte('data', from)
            .lte('data', to)
        if (operatoreIds && operatoreIds.length > 0) q = q.in('operatore_id', operatoreIds)
        return q
            .order('timestamp', { ascending: true })
            .order('id', { ascending: true })
            .range(da, a) as unknown as PromiseLike<{ data: TimbraturaBustaPaga[] | null; error: unknown }>
    })
    const err = res.error as { message?: string } | null
    return { data: res.data, error: err ? (err.message || String(err)) : null }
}

/**
 * Giornate di UN operatore: entrata/uscita (l'ultima timbrata del giorno),
 * pause a mano + fasce di contratto (modello per-fascia), minuti lavorati.
 * `giorni` = i giorni da restituire (anche quelli vuoti, per il dettaglio).
 * Le timbrature devono essere in ordine di timestamp.
 */
export function costruisciGiornate(
    timbrature: TimbraturaBustaPaga[],
    giorni: string[],
    pauseConfig: PauseConfig | null | undefined
): GiornataBustaPaga[] {
    const byDay = new Map<string, TimbraturaBustaPaga[]>()
    for (const e of timbrature) {
        if (!byDay.has(e.data)) byDay.set(e.data, [])
        byDay.get(e.data)!.push(e)
    }
    return giorni.map(d => {
        const pausaObbl = pausaObbligatoriaDelGiorno(pauseConfig ?? null, d)
        const dayEntries = byDay.get(d) || []
        let entrata: string | null = null
        let uscita: string | null = null
        const pauseStarts: string[] = []
        const pauseEnds: string[] = []
        for (const e of dayEntries) {
            if (e.tipo === 'entrata') entrata = e.timestamp
            else if (e.tipo === 'uscita') uscita = e.timestamp
            else if (e.tipo === 'pausa_inizio') pauseStarts.push(e.timestamp)
            else if (e.tipo === 'pausa_fine') pauseEnds.push(e.timestamp)
        }
        const pauseWindows = pauseStarts.map((start, i) => {
            const end = pauseEnds[i] || null
            const durMin = end
                ? Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000))
                : 0
            return { start, end, durMin }
        })
        const worked = !!(entrata && uscita)
        // Modello PER-FASCIA (#32): la pausa a mano sostituisce solo la fascia
        // di contratto che sovrappone; le altre fasce restano e si vedono.
        const manualiISO = pauseWindows
            .filter(p => p.end)
            .map(p => ({ inizio: p.start, fine: p.end as string }))
        const combo = combinaPauseGiorno(d, manualiISO, pausaObbl, uscita)
        const displayWindows = combo.finestre.map(f => ({
            start: f.inizio,
            end: f.fine,
            durMin: Math.max(0, Math.floor((new Date(f.fine).getTime() - new Date(f.inizio).getTime()) / 60000)),
        }))
        let minutiLavorati = 0
        if (worked) {
            const lordo = Math.floor((new Date(uscita!).getTime() - new Date(entrata!).getTime()) / 60000)
            // Pause a mano sempre scalate; contratto non-sovrapposto solo se non pagato.
            minutiLavorati = Math.max(0, lordo - combo.scalateMin)
        }
        return { data: d, entrata, uscita, pauseWindows: displayWindows, minutiLavorati, minutiPausa: combo.mostrateMin }
    })
}

/** ISO week key (YYYY-Www): giorni della stessa settimana lun-dom. */
function isoWeekKey(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00Z')
    const day = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/**
 * Paga del periodo dalle giornate + contratto + ore a recuperare.
 * Regole (storia nei commenti di Calcola Paga, 2026-05-18 / 05-22 / 06-01):
 *  - paga oraria esplicita, altrimenti derivata dallo stipendio / ore target;
 *  - straordinario = oltre la soglia GIORNALIERA (solo se configurata) oppure
 *    oltre la SETTIMANALE, senza contare due volte la stessa ora; la settimana
 *    si spezza al confine di mese;
 *  - contratto a giornata: giornata timbrata = pagata intera, niente
 *    decurtazione ore a recuperare (pagaGiornaliera.ts).
 */
export function calcolaBustaPaga(
    days: GiornataBustaPaga[],
    contract: ContrattoBustaPaga | null | undefined,
    oreRecMin: number
): CalcoloBustaPaga {
    const dailyExplicit = contract?.ore_soglia_straordinario ?? contract?.ore_target_giornaliere
    const dailyCapMin = (dailyExplicit != null && Number(dailyExplicit) > 0)
        ? Math.round(Number(dailyExplicit) * 60)
        : 0
    const weeklyCapMin = (contract?.ore_target_settimanali != null && Number(contract.ore_target_settimanali) > 0)
        ? Math.round(Number(contract.ore_target_settimanali) * 60)
        : 0
    const sogliaMin = weeklyCapMin > 0 ? weeklyCapMin : dailyCapMin
    const sogliaMode: 'giornaliera' | 'settimanale' | 'mensile' =
        weeklyCapMin > 0 ? 'settimanale' : 'giornaliera'

    const stipendio = Number(contract?.stipendio_mensile_eur || 0)
    const freq = contract?.stipendio_frequenza
    const oraExplicit = Number(contract?.paga_oraria_eur || 0)
    const orariaDerived = (() => {
        if (oraExplicit > 0) return 0
        if (stipendio <= 0) return 0
        if (tariffaGiornaliera(contract) > 0) return 0
        const settH = Number(contract?.ore_target_settimanali || 0)
        const mensH = Number(contract?.ore_target_mensili || 0)
        const giornH = Number(contract?.ore_target_giornaliere || 0)
        if (freq === 'settimanale' && settH > 0) return stipendio / settH
        if (freq === 'mensile' && mensH > 0) return stipendio / mensH
        if (freq === 'mensile' && settH > 0) return stipendio / (settH * 4.33)
        if (freq === 'mensile' && giornH > 0) return stipendio / (giornH * 22)
        if (settH > 0) return stipendio / settH
        if (mensH > 0) return stipendio / mensH
        if (giornH > 0) return stipendio / (giornH * 22)
        return 0
    })()
    const oraria = oraExplicit > 0 ? oraExplicit : orariaDerived
    const oraSource: 'explicit' | 'derived' | 'none' =
        oraExplicit > 0 ? 'explicit' : (orariaDerived > 0 ? 'derived' : 'none')
    const straord = Number(contract?.paga_straordinario_eur || 0)
    const straordEnabled = contract?.straordinario_abilitato !== false && straord > 0 && sogliaMin > 0

    let minStraord = 0
    if (straordEnabled) {
        const weekTotal = new Map<string, number>()
        const weekDailyOT = new Map<string, number>()
        for (const d of days) {
            if (d.minutiLavorati <= 0) continue
            const wk = isoWeekKey(d.data) + '|' + String(d.data).slice(0, 7)
            weekTotal.set(wk, (weekTotal.get(wk) || 0) + d.minutiLavorati)
            const dayOT = dailyCapMin > 0 && d.minutiLavorati > dailyCapMin ? d.minutiLavorati - dailyCapMin : 0
            if (dayOT > 0) {
                weekDailyOT.set(wk, (weekDailyOT.get(wk) || 0) + dayOT)
                minStraord += dayOT
            }
        }
        if (weeklyCapMin > 0) {
            for (const [wk, total] of weekTotal) {
                const overWeek = total > weeklyCapMin ? total - weeklyCapMin : 0
                minStraord += Math.max(0, overWeek - (weekDailyOT.get(wk) || 0))
            }
        }
    }
    const minLavorati = days.reduce((s, d) => s + Math.max(0, d.minutiLavorati), 0)
    const minOrdinari = Math.max(0, minLavorati - minStraord)
    const tariffaGiorno = tariffaGiornaliera(contract)
    const giornatePagate = contaGiornatePagate(days.map(d => (d.entrata && d.uscita ? d.minutiLavorati : 0)))
    const pagaOrd = tariffaGiorno > 0 ? giornatePagate * tariffaGiorno : (minOrdinari / 60) * oraria
    const pagaStraord = (minStraord / 60) * straord
    const correzione = tariffaGiorno > 0 ? 0 : -(Number(oreRecMin || 0) / 60) * oraria
    const totale = pagaOrd + pagaStraord + correzione
    return {
        sogliaMin, sogliaMode, minLavorati, minOrdinari, minStraord,
        pagaOrd, pagaStraord, correzione, totale,
        straordEnabled, oraria, oraSource, straord, tariffaGiorno, giornatePagate,
    }
}
