import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { fetchAllIncomingInvoices } from './aruba-utils'
import { syncOneFornitore } from './sync-fornitore-invoices'
import { normalizeVat, normalizeName, namesMatch } from './utils/fornitoreMatch'

/**
 * Background function (15 min timeout): chiamata dal bottone
 * "Scopri & Sincronizza tutto" e dal cron notturno.
 *
 * 1. Auto-discover: scarica le fatture Aruba degli ultimi 12 mesi e
 *    crea automaticamente uno stub fornitore per ogni P.IVA mai vista.
 * 2. Per OGNI fornitore (incluso quelli appena creati), sincronizza le
 *    fatture INLINE chiamando syncOneFornitore (no HTTP fetch ->
 *    nessun timeout sync di Netlify a livello sub-call).
 *
 * Background functions: rispondono 202 subito; il lavoro continua
 * dietro le quinte fino a 15 minuti.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const DISCOVER_MONTHS_BACK = 12
const SYNC_MONTHS = 12

interface AutoDiscoverResult {
    scanned: number
    created: number
    duplicateSkipped: number
    /** Anagrafiche esistenti a cui abbiamo completato la P.IVA invece di duplicarle. */
    pivaCompletate: number
}

async function autoDiscoverFornitoriFromAruba(): Promise<AutoDiscoverResult> {
    const result: AutoDiscoverResult = { scanned: 0, created: 0, duplicateSkipped: 0, pivaCompletate: 0 }

    const { data: existing } = await supabase.from('fornitori').select('id, nome, piva, attivo')
    const knownPivas = new Set<string>()
    // 01/09/2026: si guardava solo la P.IVA. Un fornitore inserito a mano senza
    // P.IVA veniva quindi ricreato come stub e le stesse fatture finivano su
    // due schede (es. Hydrochem). Ora confrontiamo anche la ragione sociale.
    const perNome: { id: string; nomeNorm: string; piva: string }[] = []
    for (const f of (existing || []) as { id: string; nome: string; piva: string | null; attivo: boolean }[]) {
        const v = normalizeVat(f.piva)
        if (v) knownPivas.add(v)
        // Solo le schede attive: una disattivata da una fusione non deve
        // riprendersi la P.IVA e tornare a vivere.
        if (!f.attivo) continue
        const n = normalizeName(f.nome)
        if (n) perNome.push({ id: f.id, nomeNorm: n, piva: v })
    }

    // 31/08/2026: l'offset era scritto a mano ("+02:00" = ora legale), quindi
    // da novembre a marzo la finestra partiva un'ora fuori posto. Ora si
    // ricava dal giorno, come gia' fa get-incoming-invoices.
    const offsetRoma = (giorno: string): string => {
      const [y, m, d] = giorno.split('-').map(Number)
      const mezzogiorno = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
      const roma = mezzogiorno.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour12: false })
      const utc = mezzogiorno.toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
      const ore = Math.round((new Date(roma).getTime() - new Date(utc).getTime()) / 3600000)
      return `${ore >= 0 ? '+' : '-'}${String(Math.abs(ore)).padStart(2, '0')}:00` // controllo-date: ok
    }

    const start = new Date()
    start.setMonth(start.getMonth() - DISCOVER_MONTHS_BACK)
    const giornoInizio = start.toISOString().split('T')[0]
    const giornoFine = new Date().toISOString().split('T')[0]
    const startISO = `${giornoInizio}T00:00:00.000${offsetRoma(giornoInizio)}`
    const endISO = `${giornoFine}T23:59:59.999${offsetRoma(giornoFine)}`

    // Le pagine di Aruba partono da 1: partendo da 0 il primo blocco tornava
    // due volte e `scanned` contava 100 righe che non esistevano.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allInvoices: any[] = []
    try {
        allInvoices = await fetchAllIncomingInvoices({
            startDate: startISO,
            endDate: endISO,
            pageSize: 100,
            maxPages: 10,
        })
    } catch (e) {
        console.warn('[fornitori-bg] aruba search err:', (e as Error).message)
    }
    result.scanned = allInvoices.length

    const byPiva = new Map<string, { piva: string; nome: string }>()
    for (const inv of allInvoices) {
        const rawId = inv.senderId || inv.sender?.id || ''
        const country = inv.senderCountryCode || inv.sender?.country || 'IT'
        const piva = normalizeVat(rawId)
        if (!piva) continue
        if (knownPivas.has(piva)) continue
        const nome =
            inv.senderDescription ||
            inv.sender?.description ||
            inv.cedentePrestatore?.denominazione ||
            (country + piva)
        if (!byPiva.has(piva)) {
            byPiva.set(piva, { piva, nome: String(nome).slice(0, 200) })
        }
    }

    for (const stub of byPiva.values()) {
        // Prima di creare uno stub: esiste gia' un fornitore con lo stesso
        // nome e senza P.IVA? Allora completiamo quello, non ne creiamo un altro.
        const stubNome = normalizeName(stub.nome)
        const esistente = perNome.find(f => !f.piva && namesMatch(f.nomeNorm, stubNome))
        if (esistente) {
            const { error: updErr } = await supabase
                .from('fornitori')
                .update({ piva: stub.piva })
                .eq('id', esistente.id)
            if (!updErr) {
                esistente.piva = stub.piva
                knownPivas.add(stub.piva)
                result.pivaCompletate++
                continue
            }
            console.warn(`[fornitori-bg] backfill piva failed for ${esistente.id}:`, updErr.message)
        }
        const { error: insErr } = await supabase
            .from('fornitori')
            .insert({
                nome: stub.nome,
                piva: stub.piva,
                attivo: true,
                note: '[auto-creato dal sync Aruba — completare anagrafica]',
            })
        if (insErr) {
            if ((insErr as { code?: string }).code === '23505') {
                result.duplicateSkipped++
            } else {
                console.warn(`[fornitori-bg] insert stub failed for ${stub.piva}:`, insErr.message)
            }
        } else {
            result.created++
            perNome.push({ id: '', nomeNorm: stubNome, piva: stub.piva })
            knownPivas.add(stub.piva)
        }
    }

    return result
}

const handler: Handler = async () => {
    const startedAt = Date.now()

    let discover: AutoDiscoverResult = { scanned: 0, created: 0, duplicateSkipped: 0, pivaCompletate: 0 }
    try {
        discover = await autoDiscoverFornitoriFromAruba()
        console.log('[fornitori-bg] auto-discover:', discover)
    } catch (err) {
        console.error('[fornitori-bg] auto-discover failed:', err)
    }

    const { data: fornitori, error } = await supabase
        .from('fornitori')
        .select('id, nome')
        .eq('attivo', true)

    if (error) {
        console.error('[fornitori-bg] query error', error)
        return { statusCode: 500, body: error.message }
    }

    let synced = 0
    let inserted = 0
    let failed = 0

    for (const f of fornitori || []) {
        try {
            // Inline call: niente HTTP, niente timeout sync di Netlify per call.
            const result = await syncOneFornitore(f.id, SYNC_MONTHS)
            if (result.success) {
                synced++
                inserted += (result.inserted || 0)
            } else {
                failed++
                console.warn(`[fornitori-bg] ${f.nome}: ${result.error}`)
            }
        } catch (err) {
            failed++
            console.warn(`[fornitori-bg] ${f.nome} error:`, err)
        }
        // Throttle leggero per non saturare Aruba SDI
        await new Promise(r => setTimeout(r, 200))
    }

    const durationSec = Math.round((Date.now() - startedAt) / 1000)
    const summary = {
        totale: (fornitori || []).length,
        synced,
        inserted,
        failed,
        durationSec,
        autoDiscover: discover,
    }
    console.log('[fornitori-bg] done', summary)

    return { statusCode: 200, body: JSON.stringify({ ok: true, ...summary }) }
}

export { handler }
