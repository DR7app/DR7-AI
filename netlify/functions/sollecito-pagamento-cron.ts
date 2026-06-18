/**
 * Sollecito Pagamento — scheduled cron.
 *
 * Auto-resend del promemoria di pagamento ("sollecito") ai clienti con un
 * debito ancora aperto. Il PRIMO sollecito viene inviato manualmente
 * dall'admin in "In attesa di pagamento" (UnpaidBookingsTab → "Invia
 * Sollecito"), che stampa booking_details.sollecito = { last_sent_at, count }.
 *
 * Questo cron continua il follow-up:
 *   - solo booking ancora NON pagati (status non cancelled/annullata,
 *     payment_status non in paid/completed/succeeded) con importo residuo > 0;
 *   - solo se un primo sollecito è già partito (sollecito.last_sent_at set);
 *   - solo se sollecito.count < 3 (MAX 3 solleciti totali per debito);
 *   - solo se sono passate >= 48h dall'ultimo invio.
 *
 * Ogni invio passa per /.netlify/functions/send-whatsapp-notification con
 * templateKey 'sollecito_pagamento' → risolve al template Pro
 * "pro_promemoria_pagamento" (stesso meccanismo del bottone), poi incrementa
 * count e aggiorna last_sent_at. Dedup per cliente: un cliente riceve al
 * massimo un sollecito per run (anche con più booking aperti).
 *
 * Schedule: ogni 6 ore (netlify.toml). La finestra 48h è enforced qui dentro,
 * quindi il cron può girare spesso senza rischio di doppio invio.
 */
import { schedule } from '@netlify/functions'
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const RESEND_AFTER_MS = 48 * 60 * 60 * 1000 // 48h
const MAX_SOLLECITI = 3
const PAID_STATUSES = new Set(['paid', 'completed', 'succeeded'])
const CANCELLED_STATUSES = new Set(['cancelled', 'annullata'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Booking = any

/**
 * Importo residuo (in CENTESIMI) ancora dovuto su una booking. Stessa logica
 * di getRemainingAmount in UnpaidBookingsTab, senza la parte fatture (che è
 * un dettaglio UI): base/parziale + penali + danni non ancora saldati.
 */
function getRemainingCents(b: Booking): number {
    let remaining = 0
    const bd = b.booking_details || {}

    if (b.payment_status === 'pending' || b.payment_status === 'unpaid' || b.payment_status === 'partial') {
        const total = b.price_total || 0
        const paid = bd.amountPaid || 0
        remaining += Math.max(0, total - paid)
    } else {
        const extensions = bd.extension_history || []
        for (const ext of extensions) {
            if ((ext.payment_status === 'pending' || ext.payment_status === 'partial' || ext.payment_status === 'nexi_pay_by_link') && ext.additional_amount) {
                const extTotal = ext.additional_amount * 100
                const extPaid = (ext.amount_paid || 0) * 100
                remaining += Math.max(0, extTotal - extPaid)
            }
        }
    }

    for (const p of (bd.penalties || [])) {
        if (!p.paymentStatus || p.paymentStatus === 'pending' || p.paymentStatus === 'partial' || p.paymentStatus === 'nexi_pay_by_link') {
            const total = p.total || (p.amount || 0) * (p.quantity || 1)
            const discount = p.discount || 0
            const paid = p.amountPaid || 0
            remaining += Math.round((total - discount - paid) * 100)
        }
    }

    for (const d of (bd.danni || [])) {
        if (!d.paymentStatus || d.paymentStatus === 'pending' || d.paymentStatus === 'partial' || d.paymentStatus === 'nexi_pay_by_link') {
            const total = d.total || (d.amount || 0) * (d.quantity || 1)
            const discount = d.discount || 0
            const paid = d.amountPaid || 0
            remaining += Math.round((total - discount - paid) * 100)
        }
    }

    return remaining
}

const cronHandler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
    const skip = (reason: string) => {
        console.log('[sollecito-pagamento-cron] skip:', reason)
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason }) }
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return skip('missing supabase env')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── 1. Carica i booking non-cancellati e non-pagati che HANNO già un
    // sollecito stampato (sollecito.last_sent_at set). Filtriamo lato JS su
    // booking_details perché è JSONB e il filtro Postgres su nested key sarebbe
    // fragile; il volume "In attesa di pagamento" è piccolo.
    const { data: rows, error } = await supabase
        .from('bookings')
        .select('id, customer_name, customer_phone, service_type, status, payment_status, price_total, booking_details')
        .not('status', 'in', `(${[...CANCELLED_STATUSES].join(',')})`)

    if (error) return skip(`query error: ${error.message}`)

    const now = Date.now()
    const siteUrl = process.env.URL || process.env.DEPLOY_URL || ''

    interface Candidate { booking: Booking; phone: string; remainingCents: number; count: number }
    const candidates: Candidate[] = []
    for (const b of (rows || [])) {
        if (PAID_STATUSES.has(String(b.payment_status || '').toLowerCase())) continue
        const sollecito = b.booking_details?.sollecito
        const lastSentAt = sollecito?.last_sent_at
        if (!lastSentAt) continue                         // primo invio è manuale
        const count = Number(sollecito?.count || 0)
        if (count >= MAX_SOLLECITI) continue              // max 3 totali
        const lastMs = new Date(lastSentAt).getTime()
        if (!Number.isFinite(lastMs)) continue
        if (now - lastMs < RESEND_AFTER_MS) continue      // non ancora 48h
        const remainingCents = getRemainingCents(b)
        if (remainingCents <= 0) continue                 // niente da incassare
        const phone = b.customer_phone || b.booking_details?.customer?.phone
        if (!phone) continue
        candidates.push({ booking: b, phone, remainingCents, count })
    }

    if (candidates.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0, skipped: 0, failed: 0, message: 'no booking due for resend' }) }
    }

    // ── 2. Dedup per cliente: un solo sollecito per persona per run. Aggrega i
    // booking aperti dello stesso telefono e somma il residuo per il messaggio.
    const byPhone = new Map<string, { phone: string; customerName: string; serviceType: string; totalCents: number; bookings: Candidate[] }>()
    for (const c of candidates) {
        const key = String(c.phone).replace(/\D/g, '')
        const existing = byPhone.get(key)
        if (existing) {
            existing.totalCents += c.remainingCents
            existing.bookings.push(c)
        } else {
            byPhone.set(key, {
                phone: c.phone,
                customerName: c.booking.customer_name || 'Cliente',
                serviceType: c.booking.service_type || 'rental',
                totalCents: c.remainingCents,
                bookings: [c],
            })
        }
    }

    let sent = 0
    let failed = 0
    const results: Array<{ phone: string; ok: boolean; detail?: string }> = []

    for (const group of byPhone.values()) {
        const customerName = group.customerName
        const firstName = customerName.split(' ')[0] || 'Cliente'
        const amountStr = (group.totalCents / 100).toFixed(2)
        try {
            const res = await fetch(`${siteUrl}/.netlify/functions/send-whatsapp-notification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customPhone: group.phone,
                    templateKey: 'sollecito_pagamento',
                    booking: { service_type: group.serviceType },
                    templateVars: {
                        '{nome}': firstName,
                        '{customer_name}': customerName,
                        '{importo}': amountStr,
                        '{amount}': amountStr,
                        '{total}': amountStr,
                    },
                }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok || json.skipped) {
                failed++
                results.push({ phone: group.phone, ok: false, detail: json.reason || json.message || `HTTP ${res.status}` })
                continue
            }

            // ── 3. Incrementa count + aggiorna last_sent_at su OGNI booking del
            // gruppo (merge, non sovrascrivere altre chiavi di booking_details).
            const nowIso = new Date().toISOString()
            for (const c of group.bookings) {
                try {
                    const existing = c.booking.booking_details || {}
                    await supabase
                        .from('bookings')
                        .update({
                            booking_details: {
                                ...existing,
                                sollecito: { last_sent_at: nowIso, count: c.count + 1 },
                            },
                        })
                        .eq('id', c.booking.id)
                } catch (e) {
                    console.error('[sollecito-pagamento-cron] stamp failed for booking', c.booking.id, e instanceof Error ? e.message : String(e))
                }
            }
            sent++
            results.push({ phone: group.phone, ok: true })
        } catch (err) {
            failed++
            results.push({ phone: group.phone, ok: false, detail: err instanceof Error ? err.message : String(err) })
        }
        // Throttle ~5 msg/sec, in linea con gli altri cron Green API.
        await new Promise(r => setTimeout(r, 200))
    }

    console.log(`[sollecito-pagamento-cron] done — sent=${sent} failed=${failed} candidates=${candidates.length} customers=${byPhone.size}`)
    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, sent, failed, candidates: candidates.length, customers: byPhone.size, results }),
    }
}

// Ogni 6 ore. La finestra 48h è enforced dentro l'handler, quindi più run
// ravvicinati non causano doppi invii.
export const handler = schedule('0 */6 * * *', cronHandler)
