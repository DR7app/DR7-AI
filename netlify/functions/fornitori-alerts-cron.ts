import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Daily cron — Phase 4 smart alerts for the Fornitori module.
 *
 * Generates / refreshes alerts for:
 *   - scadenza_imminente: invoice due in 7 / 3 days
 *   - scadenza_oggi:       invoice due today
 *   - scaduta:             invoice past due, not paid
 *   - bolle_mancanti:      fattura with zero matched DDT/bolle in same month
 *
 * Alerts are deduplicated per (document_id, tipo) so the cron is idempotent.
 * Optionally pings Green API admin number with a daily digest.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN
const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205'

interface FattureRow {
    id: string
    fornitore_id: string
    numero_documento: string
    data_scadenza: string | null
    importo_totale: number
    stato: string
    periodo_anno: number
    periodo_mese: number
    fornitori?: { nome: string } | null
}

async function ensureAlert(params: {
    fornitore_id: string
    document_id: string
    tipo: 'scadenza_imminente' | 'scadenza_oggi' | 'scaduta' | 'bolle_mancanti'
    severity: 'info' | 'warning' | 'error'
    messaggio: string
    metadata?: Record<string, unknown>
}): Promise<boolean> {
    // Dedupe: skip if same (document_id, tipo) already open / acknowledged
    const { data: existing } = await supabase
        .from('fornitore_alerts')
        .select('id, status')
        .eq('document_id', params.document_id)
        .eq('tipo', params.tipo)
        .in('status', ['open', 'acknowledged'])
        .maybeSingle()
    if (existing) return false
    const { error } = await supabase.from('fornitore_alerts').insert({
        fornitore_id: params.fornitore_id,
        document_id: params.document_id,
        tipo: params.tipo,
        severity: params.severity,
        messaggio: params.messaggio,
        metadata: params.metadata || {},
    })
    if (error) {
        console.error('[fornitori-alerts-cron] insert error', error)
        return false
    }
    return true
}

const handler: Handler = async () => {
    const today = new Date()
    const todayISO = today.toISOString().slice(0, 10)
    const in3 = new Date(today); in3.setDate(in3.getDate() + 3)
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7)

    let scadutaCount = 0
    let oggiCount = 0
    let imminenteCount = 0
    let bolleMancCount = 0

    // 1. Scadute / oggi / imminenti — all open fatture with data_scadenza
    const { data: fatture, error } = await supabase
        .from('fornitore_documents')
        .select('id, fornitore_id, numero_documento, data_scadenza, importo_totale, stato, periodo_anno, periodo_mese, fornitori:fornitori(nome)')
        .eq('tipo', 'fattura')
        .not('data_scadenza', 'is', null)
        .not('stato', 'in', '(pagato,archiviato,bloccato)')
        .returns<FattureRow[]>()
    if (error) {
        console.error('[fornitori-alerts-cron] query error', error)
        return { statusCode: 500, body: error.message }
    }

    // Skip already-paid / archived / blocked fatture — only alert on the
    // ones that are still actually outstanding.
    const unpaidStati = new Set(['caricato', 'verificato', 'in_verifica', 'anomalia', 'approvato', 'pagabile'])
    for (const f of fatture || []) {
        if (!f.data_scadenza) continue
        if (!unpaidStati.has(f.stato)) continue
        const fornitoreNome = f.fornitori?.nome || 'fornitore'
        const scad = new Date(f.data_scadenza)
        scad.setHours(0, 0, 0, 0)
        const days = Math.ceil((scad.getTime() - new Date(todayISO).getTime()) / 86400000)
        if (days < 0) {
            const created = await ensureAlert({
                fornitore_id: f.fornitore_id,
                document_id: f.id,
                tipo: 'scaduta',
                severity: 'error',
                messaggio: `Fattura n.${f.numero_documento} di ${fornitoreNome} scaduta da ${-days} giorni (€${Number(f.importo_totale).toFixed(2)})`,
                metadata: { days_overdue: -days, scadenza: f.data_scadenza },
            })
            if (created) scadutaCount++
        } else if (days === 0) {
            const created = await ensureAlert({
                fornitore_id: f.fornitore_id,
                document_id: f.id,
                tipo: 'scadenza_oggi',
                severity: 'error',
                messaggio: `Fattura n.${f.numero_documento} di ${fornitoreNome} scade oggi (€${Number(f.importo_totale).toFixed(2)})`,
                metadata: { scadenza: f.data_scadenza },
            })
            if (created) oggiCount++
        } else if (days <= 7) {
            const created = await ensureAlert({
                fornitore_id: f.fornitore_id,
                document_id: f.id,
                tipo: 'scadenza_imminente',
                severity: days <= 3 ? 'error' : 'warning',
                messaggio: `Fattura n.${f.numero_documento} di ${fornitoreNome} scade in ${days} giorni (€${Number(f.importo_totale).toFixed(2)})`,
                metadata: { days_until: days, scadenza: f.data_scadenza },
            })
            if (created) imminenteCount++
        }
    }

    // 2. bolle_mancanti — fatture in stato verificato/anomalia/in_verifica without DDT in same month
    // Skip fatture older than 60 days to avoid flooding with alerts when historical
    // invoices are bulk-synced from Aruba (backfill). Old imports have no bolle by
    // definition; flagging them as payment-blocking is noise.
    const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    for (const f of fatture || []) {
        if (!['verificato', 'anomalia', 'in_verifica', 'caricato'].includes(f.stato)) continue
        if (f.data_documento && f.data_documento < SIXTY_DAYS_AGO) continue
        const { count } = await supabase
            .from('fornitore_documents')
            .select('id', { count: 'exact', head: true })
            .eq('fornitore_id', f.fornitore_id)
            .in('tipo', ['ddt', 'bolla'])
            .eq('periodo_anno', f.periodo_anno)
            .eq('periodo_mese', f.periodo_mese)
        if ((count || 0) === 0) {
            const fornitoreNome = f.fornitori?.nome || 'fornitore'
            const created = await ensureAlert({
                fornitore_id: f.fornitore_id,
                document_id: f.id,
                tipo: 'bolle_mancanti',
                severity: 'warning',
                messaggio: `Fattura n.${f.numero_documento} di ${fornitoreNome} senza DDT/bolle nel mese — verificare`,
            })
            if (created) bolleMancCount++
            // NOTE (Apr 2026): non auto-blocchiamo piu' la fattura.
            // Tanti fornitori (SaaS / servizi / utenze: Openapi, hosting,
            // telefonia, ecc.) non emettono mai un DDT, quindi la logica
            // "no DDT -> bloccato" nascondeva fatture legittime in tutti
            // i view (Panoramica, Registro Mensile, Scadenziario, Detail).
            // Caso reale: Openapi SpA AV-BU-47531 sparita dalla tab.
            // L'alert basta a segnalare il caso; il blocco lo decide
            // l'operatore manualmente quando serve davvero.
        }
    }

    const summary = {
        in_ritardo: scadutaCount,
        oggi: oggiCount,
        imminenti: imminenteCount,
        bolle_mancanti: bolleMancCount,
    }
    console.log('[fornitori-alerts-cron]', summary)

    // Daily digest WhatsApp
    const total = scadutaCount + oggiCount + imminenteCount + bolleMancCount
    if (total > 0 && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
        const lines = [
            '*FORNITORI — Alert giornalieri*',
            scadutaCount > 0 ? `Scadute (in ritardo): ${scadutaCount}` : null,
            oggiCount > 0 ? `Scadenza oggi: ${oggiCount}` : null,
            imminenteCount > 0 ? `Scadenza in arrivo (<= 7gg): ${imminenteCount}` : null,
            bolleMancCount > 0 ? `Fatture bloccate (bolle mancanti): ${bolleMancCount}` : null,
        ].filter(Boolean)
        const body = lines.join('\n')
        try {
            await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: `${NOTIFICATION_PHONE}@c.us`, message: body }),
            })
        } catch (e) {
            console.error('[fornitori-alerts-cron] whatsapp error', e)
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, summary }),
    }
}

export { handler }
