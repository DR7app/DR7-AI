/**
 * Promo Incassi — manual fire endpoint.
 *
 * Runs the same logic as the scheduled cron but bypasses the Rome-hour
 * gate so admin can manually trigger from the UI when the scheduled run
 * was missed (e.g. Netlify deploy collision).
 *
 * Reads mode/pilot_phone/threshold_coeff from promo_incassi_settings
 * just like the cron does.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { computeVehicleMonthlyRevenue } from './utils/vehicleRevenue'
import { requireAuth } from './require-auth'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

interface Vehicle { id: string; display_name: string; plate: string | null; status: string | null; category: string | null }
interface RevenueTier { min_revenue: number | null | undefined; coeff: number | null | undefined }

function normalisePhone(raw: string): string | null {
    let clean = (raw || '').replace(/[^\d]/g, '')
    if (!clean) return null
    if (clean.startsWith('00')) clean = clean.slice(2)
    if (clean.startsWith('0')) clean = '39' + clean.slice(1)
    if (!clean.startsWith('39') && clean.length === 10) clean = '39' + clean
    if (clean.length < 11) return null
    return clean
}

function romeYearMonth(): { year: number; month: number; ym: string } {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' })
    const ym = fmt.format(new Date())
    const [y, m] = ym.split('-')
    return { year: Number(y), month: Number(m), ym }
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const skip = (reason: string) => ({ statusCode: 200, body: JSON.stringify({ skipped: true, reason }) })
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return skip('missing supabase env')
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) return skip('missing green api env')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: settings } = await supabase
        .from('promo_incassi_settings')
        .select('mode, pilot_phone, threshold_coeff')
        .eq('id', 1)
        .maybeSingle()
    const mode = (settings?.mode || 'off') as 'off' | 'pilot' | 'broadcast'
    if (mode === 'off') return skip('mode=off')
    const thresholdCoeff = Number(settings?.threshold_coeff ?? 0.8)
    if (!Number.isFinite(thresholdCoeff) || thresholdCoeff <= 0) return skip(`invalid threshold_coeff: ${settings?.threshold_coeff}`)

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

    const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
    const cfg = (cfgRow?.config || {}) as {
        prezzoDinamico?: { dynamic?: { vehicle_revenue_targets?: Record<string, { tiers?: RevenueTier[] }> } };
        vehicle_revenue_targets?: Record<string, { tiers?: RevenueTier[] }>;
    }
    const targets = cfg.prezzoDinamico?.dynamic?.vehicle_revenue_targets || cfg.vehicle_revenue_targets || {}

    const vehicleIdsWithTarget = Object.keys(targets).filter(vid => {
        const tiers = targets[vid]?.tiers || []
        return tiers.some(t => Number.isFinite(Number(t.min_revenue)) && Number.isFinite(Number(t.coeff)))
    })
    if (vehicleIdsWithTarget.length === 0) return skip('no vehicle_revenue_targets configured')

    const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, display_name, plate, status, category')
        .in('id', vehicleIdsWithTarget)
    const vehicles: Vehicle[] = (vehiclesData || []).filter(v => v.display_name !== 'Test')
    if (vehicles.length === 0) return skip('no matching vehicles found in DB')

    const { year, month, ym } = romeYearMonth()
    const { data: alreadySent } = await supabase
        .from('promo_incassi_sent_log')
        .select('vehicle_id, recipient')
        .eq('year_month', ym)
    const sentSet = new Set((alreadySent || []).map(r => `${r.vehicle_id}|${r.recipient}`))

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || ''

    let sent = 0, skipped = 0, failed = 0
    const results: Array<{ vehicle: string; activeCoeff: number; recipient: string; ok: boolean; detail?: string }> = []

    interface Triggering { v: Vehicle; activeCoeff: number; thresholdMin: number; totalRevenue: number }
    const triggering: Triggering[] = []
    for (const v of vehicles) {
        const tiers = (targets[v.id]?.tiers || [])
            .map(t => ({ min: Number(t.min_revenue), coeff: Number(t.coeff) }))
            .filter(t => Number.isFinite(t.min) && Number.isFinite(t.coeff) && t.coeff > 0)
        if (tiers.length === 0) continue
        const { totalRevenue } = await computeVehicleMonthlyRevenue(supabase, { id: v.id, plate: v.plate, display_name: v.display_name }, year, month)
        const reached = tiers.filter(t => totalRevenue >= t.min).sort((a, b) => b.min - a.min)
        if (reached.length === 0) continue
        const activeCoeff = reached[0].coeff
        if (activeCoeff > thresholdCoeff) continue
        triggering.push({ v, activeCoeff, thresholdMin: reached[0].min, totalRevenue })
    }
    triggering.sort((a, b) => a.activeCoeff - b.activeCoeff)

    if (triggering.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ ok: true, mode, year_month: ym, threshold_coeff: thresholdCoeff, sent: 0, skipped: 0, failed: 0, results: [] }) }
    }

    for (const pick of triggering) {
        for (const phone of recipients) {
            const dedupKey = `${pick.v.id}|${phone}`
            if (sentSet.has(dedupKey)) {
                skipped++
                continue
            }
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
                skipped++
                sentSet.add(dedupKey)
                continue
            }
            sentSet.add(dedupKey)

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
                    body: JSON.stringify({ templateKey: 'pro_promo_incassi', templateVars, customPhone: phone }),
                })
                const json = await res.json().catch(() => ({}))
                if (!res.ok || json.skipped) { failed++; results.push({ vehicle: pick.v.display_name, activeCoeff: pick.activeCoeff, recipient: phone, ok: false, detail: json.message || json.reason || `HTTP ${res.status}` }); continue }
                sent++
            } catch (err) {
                failed++
                results.push({ vehicle: pick.v.display_name, activeCoeff: pick.activeCoeff, recipient: phone, ok: false, detail: err instanceof Error ? err.message : String(err) })
            }
            await new Promise(r => setTimeout(r, 200))
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, mode, year_month: ym, threshold_coeff: thresholdCoeff, recipients: recipients.length, triggering: triggering.length, sent, skipped, failed }),
    }
}
