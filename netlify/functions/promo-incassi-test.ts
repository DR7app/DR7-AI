/**
 * Promo Incassi — manual test endpoint.
 *
 * Mirror of maxi-promo-gap-test for the Promo Incassi flow. Two modes:
 *
 *   - dryRun: true                 → just lists vehicles whose active monthly
 *                                    coefficient is at or below the threshold
 *                                    (no WhatsApp send, no DB write).
 *   - phone: "+39 ..."             → fires the template "promo_incassi" to that
 *                                    single phone for every triggering vehicle,
 *                                    bypassing the dedup ledger so admin can
 *                                    re-test the body whenever they want.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { computeVehicleMonthlyRevenue } from './utils/vehicleRevenue'
import { requireAuth } from './require-auth'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

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

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Missing supabase env' }) }
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = JSON.parse(event.body || '{}') as { dryRun?: boolean; phone?: string }
    const dryRun = !!body.dryRun
    const phoneInput = (body.phone || '').trim()

    const { data: settings } = await supabase
        .from('promo_incassi_settings')
        .select('threshold_coeff')
        .eq('id', 1)
        .maybeSingle()
    const thresholdCoeff = Number(settings?.threshold_coeff ?? 0.8)

    const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
    const targets = (cfgRow?.config as { vehicle_revenue_targets?: Record<string, { tiers?: RevenueTier[] }> } | undefined)
        ?.vehicle_revenue_targets || {}

    const vehicleIdsWithTarget = Object.keys(targets).filter(vid => {
        const tiers = targets[vid]?.tiers || []
        return tiers.some(t => Number.isFinite(Number(t.min_revenue)) && Number.isFinite(Number(t.coeff)))
    })

    const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, display_name, plate')
        .in('id', vehicleIdsWithTarget.length ? vehicleIdsWithTarget : ['00000000-0000-0000-0000-000000000000'])
    const vehicles = (vehiclesData || []).filter(v => v.display_name !== 'Test')

    const { year, month, ym } = romeYearMonth()

    const triggering: Array<{
        id: string;
        name: string;
        plate: string | null;
        monthly_revenue: number;
        active_coeff: number;
        threshold_min: number;
    }> = []

    for (const v of vehicles) {
        const tiers = (targets[v.id]?.tiers || [])
            .map(t => ({ min: Number(t.min_revenue), coeff: Number(t.coeff) }))
            .filter(t => Number.isFinite(t.min) && Number.isFinite(t.coeff) && t.coeff > 0)
        if (tiers.length === 0) continue

        const { totalRevenue } = await computeVehicleMonthlyRevenue(
            supabase, { id: v.id, plate: v.plate, display_name: v.display_name }, year, month
        )
        const reached = tiers.filter(t => totalRevenue >= t.min).sort((a, b) => b.min - a.min)
        if (reached.length === 0) continue
        const activeCoeff = reached[0].coeff
        if (activeCoeff > thresholdCoeff) continue

        triggering.push({
            id: v.id,
            name: v.display_name,
            plate: v.plate,
            monthly_revenue: Math.round(totalRevenue * 100) / 100,
            active_coeff: activeCoeff,
            threshold_min: reached[0].min,
        })
    }

    if (dryRun) {
        return {
            statusCode: 200,
            body: JSON.stringify({
                ok: true,
                dryRun: true,
                year_month: ym,
                threshold_coeff: thresholdCoeff,
                count: triggering.length,
                vehicles: triggering,
            }),
        }
    }

    if (!phoneInput) {
        return { statusCode: 400, body: JSON.stringify({ error: 'phone required when dryRun=false' }) }
    }
    const recipient = normalisePhone(phoneInput)
    if (!recipient) {
        return { statusCode: 400, body: JSON.stringify({ error: `phone invalid: ${phoneInput}` }) }
    }

    if (triggering.length === 0) {
        return {
            statusCode: 200,
            body: JSON.stringify({
                ok: true,
                year_month: ym,
                threshold_coeff: thresholdCoeff,
                vehiclesFound: 0,
                sent: 0,
                failed: 0,
                recipient,
                results: [],
            }),
        }
    }

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || ''
    const results: Array<{ vehicle: string; ok: boolean; reason?: string }> = []
    let sent = 0
    let failed = 0

    for (const v of triggering) {
        const templateVars = {
            vehicle: v.name,
            veicolo: v.name,
            vehicle_specs: v.name,
            coefficient: String(v.active_coeff),
            coefficiente: String(v.active_coeff),
            incasso_attuale: v.monthly_revenue.toFixed(0),
            incasso: v.monthly_revenue.toFixed(0),
            soglia: String(v.threshold_min),
            month: String(month),
            year: String(year),
            year_month: ym,
        }
        try {
            const res = await fetch(`${siteUrl}/.netlify/functions/send-whatsapp-notification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateKey: 'promo_incassi', templateVars, customPhone: recipient }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok || json.skipped) {
                failed++
                results.push({ vehicle: v.name, ok: false, reason: json.message || json.reason || `HTTP ${res.status}` })
            } else {
                sent++
                results.push({ vehicle: v.name, ok: true })
            }
        } catch (err) {
            failed++
            results.push({ vehicle: v.name, ok: false, reason: err instanceof Error ? err.message : String(err) })
        }
        await new Promise(r => setTimeout(r, 800))
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            ok: true,
            year_month: ym,
            threshold_coeff: thresholdCoeff,
            vehiclesFound: triggering.length,
            sent,
            failed,
            recipient,
            results,
            vehicles: triggering,
        }),
    }
}
