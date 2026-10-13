/**
 * Allarme "Cliente a 250 punti lavaggio" (12/10/2026).
 *
 * I punti li assegna il database (trigger trg_dr7_punti_lavaggio su bookings,
 * migrazione 20261012_punti_lavaggio_dal_database.sql) per ogni lavaggio
 * pagato, dal gestionale come dal sito. Ogni buono da 25 EUR emesso e' una
 * riga `fidelity_buoni`: qui la si trasforma nella finestra centrale con il
 * suono, finche' qualcuno non preme Risolto o passa la soglia (minuti dopo
 * l'emissione). Il messaggio al cliente lo manda alarm-engine-cron
 * (netlify/functions/utils/buoniFidelity.ts), non questo modulo.
 */
import { sogliaMs, type ClienteAllarmi, type Detector, type ModuloAllarmi } from '../alarmDetectors'
import { getRomeDateComponents } from '../timezoneUtils'

export const EXTRA_BUONI_FIDELITY = 'buoni_fidelity'

/** Quanto indietro si legge: la soglia massima sensata dal gestionale. */
const ORE_LETTURA = 72

export interface BuonoFidelityLite {
    id: string
    booking_id: string
    voucher_code: string
    importo: number
    punti_soglia: number
    punti_rimasti: number
    created_at: string
    messaggio_esito?: string | null
    cliente?: string | null
}

function oraIt(iso: string): string {
    const c = getRomeDateComponents(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(c.day)}/${p(c.month)}/${c.year} ${p(c.hour)}:${p(c.minute)}`
}

async function carica(now: Date, sb: ClienteAllarmi): Promise<Record<string, unknown[]>> {
    const da = new Date(now.getTime() - ORE_LETTURA * 60 * 60_000).toISOString()
    const { data, error } = await sb
        .from('fidelity_buoni')
        .select('id, booking_id, voucher_code, importo, punti_soglia, punti_rimasti, created_at, messaggio_esito, customers_extended(nome, cognome, ragione_sociale, tipo_cliente)')
        .gte('created_at', da)
        .order('created_at', { ascending: false })
        .range(0, 499)
    // Migrazione non ancora eseguita: nessun buono, nessun allarme, nessun errore.
    if (error) return { [EXTRA_BUONI_FIDELITY]: [] }
    const righe = (data || []).map((r: Record<string, unknown>) => {
        const ce = (Array.isArray(r.customers_extended) ? r.customers_extended[0] : r.customers_extended) as Record<string, string | null> | null
        const cliente = ce
            ? (ce.tipo_cliente === 'azienda' ? (ce.ragione_sociale || '') : `${ce.nome || ''} ${ce.cognome || ''}`.trim())
            : ''
        return { ...r, cliente } as unknown as BuonoFidelityLite
    })
    return { [EXTRA_BUONI_FIDELITY]: righe }
}

const punti_lavaggio_250: Detector = (cfg, ctx) => {
    const finestra = sogliaMs(cfg)
    const righe = (ctx.extra?.[EXTRA_BUONI_FIDELITY] || []) as BuonoFidelityLite[]
    return righe
        .filter(r => {
            const t = new Date(String(r.created_at || '')).getTime()
            if (!Number.isFinite(t)) return false
            const eta = ctx.now.getTime() - t
            return eta >= -60_000 && eta <= finestra
        })
        .map(r => ({
            bookingId: String(r.booking_id),
            entita: `${r.cliente || 'Cliente'} · ${r.punti_soglia} punti · buono €${r.importo} ${r.voucher_code}`,
            dettaglio: `Buono emesso il ${oraIt(r.created_at)} · ${r.punti_rimasti} punti sulla nuova carta`
                + (r.messaggio_esito === 'inviato' ? ' · WhatsApp inviato' : r.messaggio_esito ? ` · WhatsApp non inviato (${r.messaggio_esito})` : ''),
        }))
}

export const moduloPuntiLavaggio: ModuloAllarmi = {
    nome: 'punti_lavaggio',
    detectors: { punti_lavaggio_250 },
    carica,
}
