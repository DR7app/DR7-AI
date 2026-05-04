import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { searchIncomingInvoices } from './aruba-utils'

/**
 * Cron notturno + entry point manuale (chiamato anche via fetch dal bottone
 * "Scopri & sincronizza tutto" della tab Fornitori).
 *
 * 1. Auto-discover: scarica le fatture Aruba degli ultimi 12 mesi e
 *    crea automaticamente uno stub fornitore per ogni P.IVA mai vista
 *    (nome dal sender description, attivo=true, da completare manualmente).
 * 2. Per OGNI fornitore (anche quelli appena creati), chiama internamente
 *    sync-fornitore-invoices così le fatture vengono importate in
 *    fornitore_documents e appaiono nel Registro mensile.
 *
 * Schedule: ogni notte alle 03:00 Rome.
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

    // 1. Existing fornitori P.IVAs (normalized) — used as exclusion set
    const { data: existing } = await supabase.from('fornitori').select('id, piva')
    const knownPivas = new Set<string>()
    for (const f of existing || []) {
        const v = normalizeVat(f.piva)
        if (v) knownPivas.add(v)
    }

    // 2. Pull recent SDI invoices from Aruba (paginated)
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
            console.warn('[fornitori-cron] aruba search err:', (e as Error).message)
            break
        }
    }
    result.scanned = allInvoices.length

    // 3. Group by normalized P.IVA, pick best display name per group
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

    // 4. Insert stub fornitori for unknown P.IVAs
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
            // 23505 = unique violation (race), already exists — count as skipped
            if ((insErr as { code?: string }).code === '23505') {
                result.duplicateSkipped++
            } else {
                console.warn(`[fornitori-cron] insert stub failed for ${stub.piva}:`, insErr.message)
            }
        } else {
            result.created++
        }
    }

    return result
}

const handler: Handler = async () => {
    const baseUrl = process.env.URL || 'https://admin.dr7empire.com'
    const startedAt = Date.now()

    // Step 1 — auto-discover unknown fornitori from Aruba SDI
    let discover: AutoDiscoverResult = { scanned: 0, created: 0, duplicateSkipped: 0 }
    try {
        discover = await autoDiscoverFornitoriFromAruba()
        console.log('[fornitori-fatture-sync-cron] auto-discover:', discover)
    } catch (err) {
        console.error('[fornitori-fatture-sync-cron] auto-discover failed:', err)
    }

    // Step 2 — load (now expanded) fornitori list and sync each one
    const { data: fornitori, error } = await supabase
        .from('fornitori')
        .select('id, nome')
        .eq('attivo', true)

    if (error) {
        console.error('[fornitori-fatture-sync-cron] query error', error)
        return { statusCode: 500, body: error.message }
    }

    let synced = 0
    let inserted = 0
    let failed = 0

    for (const f of fornitori || []) {
        try {
            const res = await fetch(`${baseUrl}/.netlify/functions/sync-fornitore-invoices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fornitore_id: f.id, months: SYNC_MONTHS }),
            })
            const json = await res.json().catch(() => ({}))
            if (res.ok && json.success) {
                synced++
                inserted += (json.inserted || 0)
            } else {
                failed++
                console.warn(`[fornitori-fatture-sync-cron] ${f.nome}: ${json.error || res.status}`)
            }
        } catch (err) {
            failed++
            console.warn(`[fornitori-fatture-sync-cron] ${f.nome} error:`, err)
        }
        // Throttle: 500ms tra una chiamata e l'altra per non sovraccaricare Aruba
        await new Promise(r => setTimeout(r, 500))
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
    console.log('[fornitori-fatture-sync-cron]', summary)

    return { statusCode: 200, body: JSON.stringify({ ok: true, ...summary }) }
}

export { handler }
