/**
 * Marketing campaign scheduling — cron.
 *
 * Every 5 minutes:
 *   1. Find marketing_campaigns rows where status='scheduled', scheduled_at<=now,
 *      cancelled_at IS NULL.
 *   2. For each due row, recompute audience from audience_filters (recompute
 *      semantics: tier/dr7_club lookup happens AT FIRE TIME, not at scheduling
 *      time). Insert recipient rows.
 *      - One-shot (recurrence_type='none'): same row flips to 'pending'.
 *      - Recurring: insert a CHILD campaign (status='pending', parent_campaign_id
 *        = template.id) with the recipients; advance the template's scheduled_at
 *        by the recurrence interval. If the next occurrence would exceed
 *        recurrence_end_at, mark the template 'completed'.
 *   3. Drive any pending/sending campaigns within the remaining budget by
 *      calling /.netlify/functions/send-whatsapp-campaign-chunk.
 *
 * The chunk endpoint is the single source of truth for actual Green API
 * sends, anti-spam pacing, and recipient bookkeeping. This cron only
 * materialises runs and pumps the chunk loop server-side.
 */
import { schedule } from '@netlify/functions'
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SITE_URL = process.env.URL || process.env.DEPLOY_URL || ''

type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly'

interface AudienceFilters {
    excludeBlacklist?: boolean
    excludeMember?: boolean
    excludeElite?: boolean
    excludeNewEntry?: boolean
    excludeDr7Club?: boolean
    selectedCustomerIds?: string[] | null
}

interface CustomerRow {
    id: string
    user_id: string | null
    email: string | null
    telefono: string | null
    nome: string | null
    cognome: string | null
    full_name: string | null
    status: string | null
    status_cliente: string | null
}

function normalisePhone(raw: string | null): string {
    if (!raw) return ''
    let clean = raw.replace(/[\s\-+()]/g, '').replace(/[^\d]/g, '')
    if (clean.startsWith('00')) clean = clean.substring(2)
    if (clean.length === 10) clean = '39' + clean
    return clean
}

function tierOf(c: CustomerRow): 'blacklist' | 'elite' | 'member' | 'new' {
    const manual = (c.status_cliente && c.status_cliente !== 'standard')
        ? c.status_cliente
        : (c.status && c.status !== 'standard' ? c.status : null)
    if (manual === 'blacklist') return 'blacklist'
    if (manual === 'elite') return 'elite'
    if (manual === 'member') return 'member'
    return 'new'
}

function nextOccurrence(from: Date, type: RecurrenceType, interval: number): Date {
    const next = new Date(from)
    const step = Math.max(1, interval || 1)
    if (type === 'daily') next.setUTCDate(next.getUTCDate() + step)
    else if (type === 'weekly') next.setUTCDate(next.getUTCDate() + 7 * step)
    else if (type === 'monthly') next.setUTCMonth(next.getUTCMonth() + step)
    return next
}

async function loadDr7ClubKeys(): Promise<{ userIds: Set<string>; emails: Set<string> }> {
    const userIds = new Set<string>()
    const emails = new Set<string>()
    if (!SITE_URL) return { userIds, emails }
    try {
        const res = await fetch(`${SITE_URL}/.netlify/functions/list-club-members`)
        if (!res.ok) return { userIds, emails }
        const data = await res.json() as { members?: { user_id?: string; email?: string }[] }
        for (const m of (data.members || [])) {
            if (m.user_id) userIds.add(m.user_id)
            if (m.email) emails.add(m.email.toLowerCase())
        }
    } catch (e) {
        console.warn('[process-scheduled-campaigns-cron] list-club-members failed (non-blocking):', e)
    }
    return { userIds, emails }
}

async function loadAllCustomers(sb: ReturnType<typeof createClient>): Promise<CustomerRow[]> {
    const rows: CustomerRow[] = []
    const PAGE = 1000
    let from = 0
    for (;;) {
        const { data, error } = await sb
            .from('customers_extended')
            .select('id, user_id, email, telefono, nome, cognome, full_name, status, status_cliente')
            .range(from, from + PAGE - 1)
        if (error) {
            console.warn('[process-scheduled-campaigns-cron] customers_extended fetch error:', error.message)
            break
        }
        if (!data || data.length === 0) break
        for (const r of data as CustomerRow[]) rows.push(r)
        if (data.length < PAGE) break
        from += PAGE
    }
    return rows
}

async function computeAudience(
    sb: ReturnType<typeof createClient>,
    filters: AudienceFilters,
): Promise<CustomerRow[]> {
    const all = await loadAllCustomers(sb)
    const dr7 = await loadDr7ClubKeys()

    const eligible = all.filter(c => {
        const phone = normalisePhone(c.telefono)
        if (!phone) return false
        const tier = tierOf(c)
        const isDr7 = !!((c.user_id && dr7.userIds.has(c.user_id))
            || (c.email && dr7.emails.has(c.email.toLowerCase())))
        if (filters.excludeBlacklist !== false && tier === 'blacklist') return false
        if (filters.excludeMember && tier === 'member') return false
        if (filters.excludeElite && tier === 'elite') return false
        if (filters.excludeNewEntry && tier === 'new') return false
        if (filters.excludeDr7Club && isDr7) return false
        return true
    })

    const ids = filters.selectedCustomerIds
    if (Array.isArray(ids) && ids.length > 0) {
        const set = new Set(ids)
        return eligible.filter(c => set.has(c.id))
    }
    return eligible
}

interface CampaignRow {
    id: string
    title: string
    message_text: string
    image_url: string | null
    image_urls: string[] | null
    video_url: string | null
    channel: string | null
    status: string
    scheduled_at: string | null
    recurrence_type: RecurrenceType
    recurrence_interval: number
    recurrence_end_at: string | null
    audience_filters: AudienceFilters | null
}

async function materialiseRun(
    sb: ReturnType<typeof createClient>,
    template: CampaignRow,
): Promise<{ runCampaignId: string; recipientCount: number } | null> {
    const filters = template.audience_filters || {}
    const audience = await computeAudience(sb, filters)

    let runCampaignId = template.id

    if (template.recurrence_type === 'none') {
        const { error: upErr } = await sb
            .from('marketing_campaigns')
            .update({
                status: audience.length > 0 ? 'pending' : 'completed',
                total_recipients: audience.length,
                last_run_at: new Date().toISOString(),
            })
            .eq('id', template.id)
        if (upErr) {
            console.error('[process-scheduled-campaigns-cron] one-shot update failed:', upErr.message)
            return null
        }
    } else {
        const { data: child, error: childErr } = await sb
            .from('marketing_campaigns')
            .insert({
                title: template.title,
                message_text: template.message_text,
                image_url: template.image_url,
                image_urls: template.image_urls,
                video_url: template.video_url,
                channel: template.channel || 'whatsapp',
                audience: 'scheduled_run',
                total_recipients: audience.length,
                status: audience.length > 0 ? 'pending' : 'completed',
                parent_campaign_id: template.id,
                recurrence_type: 'none',
            })
            .select('id')
            .single()

        if (childErr || !child) {
            console.error('[process-scheduled-campaigns-cron] child insert failed:', childErr?.message)
            return null
        }
        runCampaignId = (child as { id: string }).id

        // Advance the template, or close it if we've passed the end date.
        const fired = template.scheduled_at ? new Date(template.scheduled_at) : new Date()
        const next = nextOccurrence(fired, template.recurrence_type, template.recurrence_interval)
        const endAt = template.recurrence_end_at ? new Date(template.recurrence_end_at) : null
        const exhausted = endAt && next.getTime() > endAt.getTime()

        await sb
            .from('marketing_campaigns')
            .update({
                last_run_at: new Date().toISOString(),
                scheduled_at: exhausted ? template.scheduled_at : next.toISOString(),
                status: exhausted ? 'completed' : 'scheduled',
            })
            .eq('id', template.id)
    }

    if (audience.length > 0) {
        const recipientRows = audience.map(c => ({
            campaign_id: runCampaignId,
            customer_id: (c.id || '').length === 36 ? c.id : null,
            customer_name: c.full_name || `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente',
            phone: c.telefono,
            email: c.email,
            status: 'pending',
        }))
        // Insert in chunks to stay friendly to PostgREST.
        const CHUNK = 500
        for (let i = 0; i < recipientRows.length; i += CHUNK) {
            const slice = recipientRows.slice(i, i + CHUNK)
            const { error: recErr } = await sb
                .from('marketing_campaign_recipients')
                .insert(slice)
            if (recErr) {
                console.error('[process-scheduled-campaigns-cron] recipient insert failed:', recErr.message)
            }
        }
    }

    return { runCampaignId, recipientCount: audience.length }
}

async function pumpChunkLoop(deadline: number) {
    if (!SITE_URL) return
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })
    while (Date.now() < deadline) {
        const { data: live } = await sb
            .from('marketing_campaigns')
            .select('id')
            .in('status', ['pending', 'sending'])
            .order('created_at', { ascending: true })
            .limit(1)
        const next = (live as { id: string }[] | null)?.[0]
        if (!next) return

        try {
            const res = await fetch(`${SITE_URL}/.netlify/functions/send-whatsapp-campaign-chunk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campaignId: next.id }),
            })
            const result = await res.json().catch(() => ({} as { done?: boolean }))
            if (!res.ok) {
                console.warn('[process-scheduled-campaigns-cron] chunk call non-200, stopping pump:', res.status)
                return
            }
            if (result?.done) continue
        } catch (e) {
            console.warn('[process-scheduled-campaigns-cron] chunk call threw, stopping pump:', e)
            return
        }
    }
}

const cronHandler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
    const start = Date.now()
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'missing supabase env' }) }
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const nowIso = new Date().toISOString()
    const { data: due, error: dueErr } = await sb
        .from('marketing_campaigns')
        .select('id, title, message_text, image_url, image_urls, video_url, channel, status, scheduled_at, recurrence_type, recurrence_interval, recurrence_end_at, audience_filters')
        .eq('status', 'scheduled')
        .is('cancelled_at', null)
        .lte('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(20)

    if (dueErr) {
        console.error('[process-scheduled-campaigns-cron] due query failed:', dueErr.message)
        return { statusCode: 500, body: JSON.stringify({ error: dueErr.message }) }
    }

    let materialised = 0
    for (const tpl of (due as CampaignRow[] | null) || []) {
        const result = await materialiseRun(sb, tpl)
        if (result) materialised++
    }

    // Reserve ~2s for tear-down. The Netlify scheduled-function timeout is
    // 10s — give the chunk pump everything left.
    const deadline = start + 8000
    await pumpChunkLoop(deadline)

    return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, materialised, due: (due || []).length }),
    }
}

export const handler = schedule('*/5 * * * *', cronHandler)
