import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { searchIncomingInvoices } from './aruba-utils'
import { syncOneFornitore } from './sync-fornitore-invoices'

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

function normalizeVat(s: string | null | undefined): string {
    if (!s) return ''
    return s.replace(/\D/g, '')
}

interface AutoDiscoverResult {
    scanned: number
    created: number
    duplicateSkipped: number
}

async function autoDiscoverFornitoriFromAruba(): Promise<AutoDiscoverResult> {
    const result: AutoDiscoverResult = { scanned: 0, created: 0, duplicateSkipped: 0 }

    const { data: existing } = await supabase.from('fornitori').select('id, piva')
    const knownPivas = new Set<string>()
    for (const f of existing || []) {
        const v = normalizeVat(f.piva)
        if (v) knownPivas.add(v)
    }

    const start = new Date()
    start.setMonth(start.getMonth() - DISCOVER_MONTHS_BACK)
    const startISO = start.toISOString().split('T')[0] + 'T00:00:00.000+02:00'
    const endISO = new Date().toISOString().split('T')[0] + 'T23:59:59.999+02:00'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allInvoices: any[] = []
    for (let page = 0; page < 10; page++) {
        try {
            const r = await searchIncomingInvoices({
                startDate: startISO,
                endDate: endISO,
                page,
                pageSize: 100,
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items: any[] = r.invoices || r.items || []
            if (items.length === 0) break
            allInvoices.push(...items)
            if (items.length < 100) break
        } catch (e) {
            console.warn('[fornitori-bg] aruba search err:', (e as Error).message)
            break
        }
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
        }
    }

    return result
}

const handler: Handler = async () => {
    const startedAt = Date.now()

    let discover: AutoDiscoverResult = { scanned: 0, created: 0, duplicateSkipped: 0 }
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
