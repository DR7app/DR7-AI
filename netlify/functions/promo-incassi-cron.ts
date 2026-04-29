/**
 * Promo Incassi — scheduled cron.
 *
 * Runs at 09:00 and 17:00 Europe/Rome every day. For each vehicle whose
 * monthly revenue target has its ACTIVE coefficient at or below the
 * configured threshold (default 0.8), sends the Pro template "PROMO
 * INCASSI" once per (vehicle, year_month, threshold_coeff, recipient).
 *
 *   - Mode + pilot phone come from public.promo_incassi_settings.
 *   - Template body comes from Messaggi di Sistema Pro (key "promo_incassi").
 *   - Dedup ledger lives in public.promo_incassi_sent_log.
 *
 * Schedule: cron is scheduled at UTC hours that span both CET (winter)
 * and CEST (summer): 07/08/15/16 UTC. The function then checks the
 * actual Europe/Rome local hour and only runs when it equals 9 or 17.
 */
import { schedule } from '@netlify/functions'
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { computeVehicleMonthlyRevenue } from './utils/vehicleRevenue'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

interface Vehicle {
    id: string
    display_name: string
    plate: string | null
    status: string | null
    category: string | null
}

interface RevenueTier {
    min_revenue: number | null | undefined
    coeff: number | null | undefined
}

function normalisePhone(raw: string): string | null {
    let clean = (raw || '').replace(/[^\d]/g, '')
    if (!clean) return null
    if (clean.startsWith('00')) clean = clean.slice(2)
    if (clean.startsWith('0')) clean = '39' + clean.slice(1)
    if (!clean.startsWith('39') && clean.length === 10) clean = '39' + clean
    if (clean.length < 11) return null
    return clean
}

function romeHour(): number {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome', hour: '2-digit', hour12: false,
    })
    return parseInt(fmt.format(new Date()), 10)
}

function romeYearMonth(): { year: number; month: number; ym: string } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit',
    })
    const ym = fmt.format(new Date())
    const [y, m] = ym.split('-')
    return { year: Number(y), month: Number(m), ym }
}

const cronHandler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
    const skip = (reason: string) => {
        console.log('[promo-incassi-cron] skip:', reason)
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason }) }
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return skip('missing supabase env')
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) return skip('missing green api env')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    // Fire only at 09:00 and 17:00 Europe/Rome. Cron is scheduled at UTC
    // hours covering both CET (winter, UTC+1) and CEST (summer, UTC+2):
    //   09:00 Rome = 07 UTC (CEST) or 08 UTC (CET)
    //   17:00 Rome = 15 UTC (CEST) or 16 UTC (CET)
    // After DST flips, only one of each pair maps to the right Rome hour;
    // the other invocation exits here.
    const hour = romeHour()
    const FIRE_HOURS = [9, 17]
    if (!FIRE_HOURS.includes(hour)) {
        return skip(`outside fire window (current Rome hour: ${hour}, fires at: ${FIRE_HOURS.join(', ')})`)
    }

    // ── 1. Settings (mode + pilot phone + threshold) ──
    const { data: settings } = await supabase
        .from('promo_incassi_settings')
        .select('mode, pilot_phone, threshold_coeff')
        .eq('id', 1)
        .maybeSingle()

    const mode = (settings?.mode || 'off') as 'off' | 'pilot' | 'broadcast'
    if (mode === 'off') return skip('mode=off')
    const thresholdCoeff = Number(settings?.threshold_coeff ?? 0.8)
    if (!Number.isFinite(thresholdCoeff) || thresholdCoeff <= 0) {
        return skip(`invalid threshold_coeff: ${settings?.threshold_coeff}`)
    }

    // ── 2. Recipients ──
    let recipients: string[] = []
    if (mode === 'pilot') {
        const r = normalisePhone(settings?.pilot_phone || '')
        if (!r) return skip('mode=pilot but pilot_phone empty/invalid')
        recipients = [r]
    } else {
        const { data: custRows } = await supabase
            .from('customers_extended')
            .select('telefono')
            .not('telefono', 'is', null)
        const seen = new Set<string>()
        for (const row of (custRows || [])) {
            const n = normalisePhone(row.telefono || '')
            if (n && !seen.has(n)) { seen.add(n); recipients.push(n) }
        }
        if (recipients.length === 0) return skip('mode=broadcast but no customers with phone')
    }

    // ── 3. Vehicle revenue targets from Centralina Pro ──
    const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()

    // Targets live under prezzoDinamico.dynamic.vehicle_revenue_targets — the
    // same path calculate-dynamic-price.ts reads. Top-level fallback covers
    // any tenant that may have stored them at the root historically.
    const cfg = (cfgRow?.config || {}) as {
        prezzoDinamico?: { dynamic?: { vehicle_revenue_targets?: Record<string, { tiers?: RevenueTier[] }> } };
        vehicle_revenue_targets?: Record<string, { tiers?: RevenueTier[] }>;
    }
    const targets = cfg.prezzoDinamico?.dynamic?.vehicle_revenue_targets
        || cfg.vehicle_revenue_targets
        || {}

    const vehicleIdsWithTarget = Object.keys(targets).filter(vid => {
        const tiers = targets[vid]?.tiers || []
        return tiers.some(t => Number.isFinite(Number(t.min_revenue)) && Number.isFinite(Number(t.coeff)))
    })
    if (vehicleIdsWithTarget.length === 0) return skip('no vehicle_revenue_targets configured')

    // ── 4. Load vehicles ──
    const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, display_name, plate, status, category')
        .in('id', vehicleIdsWithTarget)
    const vehicles: Vehicle[] = (vehiclesData || []).filter(v => v.display_name !== 'Test')
    if (vehicles.length === 0) return skip('no matching vehicles found in DB')

    // ── 5. Dedup is now per (year_month, recipient) — ONE PROMO TOTAL per
    // person per month, regardless of how many vehicles cross the threshold.
    // If three vehicles trigger at once we still send the customer only one
    // message — the one for the BEST deal (lowest coefficient = highest
    // revenue achievement = biggest configured discount potential).
    const { year, month, ym } = romeYearMonth()
    const { data: alreadySent } = await supabase
        .from('promo_incassi_sent_log')
        .select('recipient')
        .eq('year_month', ym)
    const sentRecipients = new Set((alreadySent || []).map(r => r.recipient))

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || ''

    let totalSent = 0
    let totalSkipped = 0
    let totalFailed = 0
    const results: Array<{ vehicle: string; activeCoeff: number; recipient: string; ok: boolean; detail?: string }> = []

    // ── 6. First pass: collect every triggering vehicle (no recipients yet).
    interface Triggering { v: Vehicle; activeCoeff: number; thresholdMin: number; totalRevenue: number }
    const triggering: Triggering[] = []
    for (const v of vehicles) {
        const tiers = (targets[v.id]?.tiers || [])
            .map(t => ({ min: Number(t.min_revenue), coeff: Number(t.coeff) }))
            .filter(t => Number.isFinite(t.min) && Number.isFinite(t.coeff) && t.coeff > 0)
        if (tiers.length === 0) continue

        const { totalRevenue } = await computeVehicleMonthlyRevenue(
            supabase,
            { id: v.id, plate: v.plate, display_name: v.display_name },
            year,
            month,
        )

        const reached = tiers.filter(t => totalRevenue >= t.min).sort((a, b) => b.min - a.min)
        if (reached.length === 0) continue
        const activeCoeff = reached[0].coeff
        if (activeCoeff > thresholdCoeff) continue

        triggering.push({ v, activeCoeff, thresholdMin: reached[0].min, totalRevenue })
    }
    // Sort: lowest coefficient first = best deal first. Each recipient gets
    // assigned to the FIRST vehicle in this list they haven't been sent to
    // this month — i.e. the best available deal.
    triggering.sort((a, b) => a.activeCoeff - b.activeCoeff)

    if (triggering.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ ok: true, mode, year_month: ym, threshold_coeff: thresholdCoeff, hour, sent: 0, skipped: 0, failed: 0, results: [] }) }
    }

    // ── 7. One outer pass per recipient. Pick the best (lowest-coeff)
    // triggering vehicle and send a single message. The unique index on
    // (year_month, recipient) blocks any second insert in the same month.
    for (const phone of recipients) {
        if (sentRecipients.has(phone)) {
            totalSkipped++
            results.push({ vehicle: '—', activeCoeff: 0, recipient: phone, ok: false, detail: 'already_sent_this_month' })
            continue
        }

        const pick = triggering[0]

        // PRE-CLAIM atomically. The DB unique index on (year_month, recipient)
        // makes this transactionally safe: even with two concurrent cron runs,
        // only one INSERT succeeds — the other gets 23505 and we skip.
        const { data: claimRow, error: claimErr } = await supabase
            .from('promo_incassi_sent_log')
            .insert({
                vehicle_id: pick.v.id,
                year_month: ym,
                threshold_coeff: pick.activeCoeff,
                recipient: phone,
                template_key: 'pro_promo_incassi',
            })
            .select('id')
            .maybeSingle()
        if (claimErr || !claimRow) {
            totalSkipped++
            results.push({
                vehicle: pick.v.display_name,
                activeCoeff: pick.activeCoeff,
                recipient: phone,
                ok: false,
                detail: claimErr?.code === '23505' ? 'already_sent_db_block' : (claimErr?.message || 'claim_failed'),
            })
            sentRecipients.add(phone)
            continue
        }
        sentRecipients.add(phone)

        const templateVars = {
            vehicle: pick.v.display_name,
            veicolo: pick.v.display_name,
            vehicle_specs: pick.v.display_name,
            coefficient: String(pick.activeCoeff),
            coefficiente: String(pick.activeCoeff),
            incasso_attuale: pick.totalRevenue.toFixed(0),
            incasso: pick.totalRevenue.toFixed(0),
            soglia: String(pick.thresholdMin),
            month: String(month),
            year: String(year),
            year_month: ym,
        }

        try {
            const res = await fetch(`${siteUrl}/.netlify/functions/send-whatsapp-notification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templateKey: 'pro_promo_incassi',
                    templateVars,
                    customPhone: phone,
                }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) {
                totalFailed++
                results.push({ vehicle: pick.v.display_name, activeCoeff: pick.activeCoeff, recipient: phone, ok: false, detail: json.message || `HTTP ${res.status}` })
                continue
            }
            if (json.skipped) {
                totalFailed++
                results.push({ vehicle: pick.v.display_name, activeCoeff: pick.activeCoeff, recipient: phone, ok: false, detail: json.reason || 'template skipped' })
                continue
            }
            totalSent++
            results.push({ vehicle: pick.v.display_name, activeCoeff: pick.activeCoeff, recipient: phone, ok: true })
        } catch (err) {
            totalFailed++
            results.push({ vehicle: pick.v.display_name, activeCoeff: pick.activeCoeff, recipient: phone, ok: false, detail: err instanceof Error ? err.message : String(err) })
        }
        await new Promise(r => setTimeout(r, 800))
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            ok: true,
            mode,
            year_month: ym,
            threshold_coeff: thresholdCoeff,
            recipients: recipients.length,
            hour,
            sent: totalSent,
            skipped: totalSkipped,
            failed: totalFailed,
            results,
        }),
    }
}

// Scheduled at UTC 07:00, 08:00, 15:00, 16:00. The function checks the
// Rome-local hour and only fires when it equals 09 or 17 — so depending
// on DST the right two invocations run, the others exit early.
export const handler = schedule('0 7,8,15,16 * * *', cronHandler)
