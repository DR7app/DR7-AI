/**
 * GBP — GET /gbp-list-reviews
 *
 * Lista le ultime recensioni del profilo Google Business Profile di DR7
 * e prova a fare match fuzzy sul display name con i candidati nella
 * tabella `review_candidates`. Serve a verificare se l'integrazione
 * con Google funziona PRIMA di automatizzare il flag "gia\' recensito".
 *
 * Usa lo stesso refresh_token + location cache di gbp-report.ts.
 *
 * Output:
 *   {
 *     ok: boolean,
 *     reviews: Array<{ name, displayName, starRating, comment, createTime, updateTime, replied }>,
 *     matched: Array<{ google_review_name, google_display_name, candidate_id, candidate_name, score }>,
 *     unmatched: Array<{ google_review_name, google_display_name, hint }>,
 *     warnings: string[]
 *   }
 */
import type { Handler } from '@netlify/functions'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

interface GBPReview {
    name: string
    reviewer?: { profilePhotoUrl?: string; displayName?: string; isAnonymous?: boolean }
    starRating?: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE'
    comment?: string
    createTime?: string
    updateTime?: string
    reviewReply?: { comment?: string; updateTime?: string }
}

interface Candidate {
    id: string
    customer_name: string | null
    send_status: string | null
}

function starsToNumber(s: GBPReview['starRating']): number {
    return ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as Record<string, number>)[s || ''] || 0
}

function normName(v: string | null | undefined): string {
    return String(v || '').trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
}

function tokens(v: string | null | undefined): string[] {
    return normName(v).split(' ').filter(t => t.length >= 2)
}

function fuzzyScore(googleName: string, candidateName: string): number {
    const gt = tokens(googleName)
    const ct = tokens(candidateName)
    if (gt.length === 0 || ct.length === 0) return 0
    let hits = 0
    for (const g of gt) if (ct.includes(g)) hits += 1
    // Score normalizzato: hits / max(token count)
    return hits / Math.max(gt.length, ct.length)
}

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
}

export const handler: Handler = async () => {
    const warnings: string[] = []
    const empty = { ok: false, reviews: [], matched: [], unmatched: [], warnings }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!clientId || !clientSecret) {
        warnings.push('Credenziali Google mancanti (GOOGLE_OAUTH_CLIENT_ID/SECRET)')
        return { statusCode: 200, headers: cors, body: JSON.stringify(empty) }
    }
    if (!supabaseUrl || !supabaseKey) {
        warnings.push('Credenziali Supabase mancanti')
        return { statusCode: 200, headers: cors, body: JSON.stringify(empty) }
    }

    const sb = createClient(supabaseUrl, supabaseKey)

    // Refresh token salvato durante la connessione OAuth (vedi ga-oauth-callback)
    let refreshToken: string | undefined
    try {
        const { data } = await sb.from('app_secrets').select('value').eq('key', 'ga4_oauth_refresh_token').maybeSingle()
        refreshToken = (data?.value as { refresh_token?: string } | null)?.refresh_token
    } catch (e) {
        warnings.push(`Lookup refresh_token fallito: ${e instanceof Error ? e.message : String(e)}`)
        return { statusCode: 200, headers: cors, body: JSON.stringify(empty) }
    }

    if (!refreshToken) {
        warnings.push('Nessun refresh_token. Connetti l\'account Google da Rendimento Sito (deve includere lo scope business.manage).')
        return { statusCode: 200, headers: cors, body: JSON.stringify(empty) }
    }

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
    oauth2.setCredentials({ refresh_token: refreshToken })

    // Location cache: gia\' popolata da gbp-report.ts dopo la prima
    // chiamata. Se vuota e GBP_LOCATION_NAME non e\' set, dobbiamo fare
    // accounts.list + locations.list per scoprirla.
    let locationName: string | null = null
    let accountName: string | null = null
    try {
        const { data: locCache } = await sb.from('app_secrets').select('value').eq('key', 'gbp_location_name').maybeSingle()
        locationName = (locCache?.value as { name?: string } | null)?.name || null
        accountName = (locCache?.value as { account?: string } | null)?.account || null
    } catch { /* fall through */ }

    if (!locationName && process.env.GBP_LOCATION_NAME) {
        locationName = process.env.GBP_LOCATION_NAME
    }
    if (!accountName && process.env.GBP_ACCOUNT_NAME) {
        accountName = process.env.GBP_ACCOUNT_NAME
    }

    // Se manca uno dei due, scopriamoli (consuma quota).
    if (!locationName || !accountName) {
        try {
            const accountsRes = await oauth2.request<{ accounts: Array<{ name: string }> }>({
                url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
                method: 'GET',
            })
            const account = accountsRes.data.accounts?.[0]
            if (!account?.name) {
                warnings.push('Nessun account Google Business Profile collegato a questo Google account.')
                return { statusCode: 200, headers: cors, body: JSON.stringify(empty) }
            }
            accountName = account.name

            if (!locationName) {
                const locsRes = await oauth2.request<{ locations: Array<{ name: string; title?: string }> }>({
                    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
                    method: 'GET',
                })
                const loc = locsRes.data.locations?.[0]
                if (!loc?.name) {
                    warnings.push('Nessuna location trovata per questo account Business Profile.')
                    return { statusCode: 200, headers: cors, body: JSON.stringify(empty) }
                }
                locationName = loc.name
            }

            // Aggiorna cache cosi\' la prossima chiamata salta la discovery.
            try {
                await sb.from('app_secrets').upsert({
                    key: 'gbp_location_name',
                    value: { name: locationName, account: accountName, discovered_at: new Date().toISOString() },
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'key' })
            } catch { /* best effort */ }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            warnings.push(`Discovery account/location fallita: ${errMsg}`)
            return { statusCode: 200, headers: cors, body: JSON.stringify(empty) }
        }
    }

    // Reviews endpoint vive ancora su mybusiness.googleapis.com/v4
    // (non e\' stato migrato sui nuovi servizi v1). Path:
    //   v4/{accountName}/{locationName}/reviews
    let reviews: GBPReview[] = []
    try {
        const url = `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews?pageSize=50&orderBy=updateTime desc`
        const res = await oauth2.request<{ reviews?: GBPReview[]; averageRating?: number; totalReviewCount?: number }>({
            url,
            method: 'GET',
        })
        reviews = res.data.reviews || []
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        warnings.push(`Fetch reviews fallito: ${errMsg}`)
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ...empty, accountName, locationName }) }
    }

    // Carica candidati attivi (non SENT) per il match. Limitiamo a 500
    // recenti — chi e\' nel pool da molto tempo difficilmente recensisce ora.
    let candidates: Candidate[] = []
    try {
        const { data } = await sb
            .from('review_candidates')
            .select('id, customer_name, send_status')
            .neq('send_status', 'SENT')
            .order('updated_at', { ascending: false })
            .limit(500)
        candidates = (data || []) as Candidate[]
    } catch (e) {
        warnings.push(`Fetch review_candidates fallito: ${e instanceof Error ? e.message : String(e)}`)
    }

    const matched: Array<{ google_review_name: string; google_display_name: string; candidate_id: string; candidate_name: string; score: number; stars: number; comment: string | null; create_time: string | null }> = []
    const unmatched: Array<{ google_review_name: string; google_display_name: string; stars: number; comment: string | null; create_time: string | null; hint: string }> = []

    for (const r of reviews) {
        const displayName = r.reviewer?.displayName || ''
        if (!displayName) continue
        let best: { cand: Candidate; score: number } | null = null
        for (const c of candidates) {
            if (!c.customer_name) continue
            const s = fuzzyScore(displayName, c.customer_name)
            if (!best || s > best.score) best = { cand: c, score: s }
        }
        const stars = starsToNumber(r.starRating)
        const comment = r.comment || null
        const create_time = r.createTime || null
        if (best && best.score >= 0.5) {
            matched.push({
                google_review_name: r.name,
                google_display_name: displayName,
                candidate_id: best.cand.id,
                candidate_name: best.cand.customer_name || '',
                score: Math.round(best.score * 100) / 100,
                stars,
                comment,
                create_time,
            })
        } else {
            unmatched.push({
                google_review_name: r.name,
                google_display_name: displayName,
                stars,
                comment,
                create_time,
                hint: best ? `migliore candidato: "${best.cand.customer_name}" (score ${Math.round(best.score * 100) / 100})` : 'nessun candidato attivo',
            })
        }
    }

    return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
            ok: true,
            accountName,
            locationName,
            totalReviews: reviews.length,
            matched,
            unmatched,
            warnings,
        }),
    }
}
