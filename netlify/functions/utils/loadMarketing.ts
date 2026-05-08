/**
 * Server-side marketing config loader.
 *
 * Reads `centralina_pro_config.config.marketing` (website URL, Google
 * review link, social URLs) and caches at module level for 60s.
 *
 * Operators set these in Supabase (manually for now — could be exposed
 * in admin Centralina Pro later). Falls back to hardcoded defaults so
 * functions stay safe if the row hasn't been seeded yet.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const TTL_MS = 60_000

const DEFAULTS = {
    website_url: 'https://dr7empire.com',
    google_review_link: 'https://g.page/r/CQwgJt7OYpsfEBM/review',
    instagram_url: 'https://instagram.com/dr7empire',
    facebook_url: 'https://facebook.com/dr7empire',
}

export interface MarketingConfig {
    website_url: string
    google_review_link: string
    instagram_url: string
    facebook_url: string
}

interface Cache {
    value: MarketingConfig
    expires: number
}

let cache: Cache | null = null

function getClient(supabase?: SupabaseClient): SupabaseClient | null {
    if (supabase) return supabase
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return null
    return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** Returns marketing URLs. Cached for 60s. Pass an existing supabase client to avoid creating a new one. */
export async function getMarketingConfig(supabase?: SupabaseClient): Promise<MarketingConfig> {
    const now = Date.now()
    if (cache && cache.expires > now) return cache.value

    const value: MarketingConfig = { ...DEFAULTS }
    const client = getClient(supabase)
    if (client) {
        try {
            const { data } = await client
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            const cfg = (data?.config ?? null) as Record<string, unknown> | null
            const marketing = cfg?.marketing as Record<string, unknown> | undefined
            if (marketing) {
                if (typeof marketing.website_url === 'string' && marketing.website_url.trim()) value.website_url = marketing.website_url
                if (typeof marketing.google_review_link === 'string' && marketing.google_review_link.trim()) value.google_review_link = marketing.google_review_link
                if (typeof marketing.instagram_url === 'string' && marketing.instagram_url.trim()) value.instagram_url = marketing.instagram_url
                if (typeof marketing.facebook_url === 'string' && marketing.facebook_url.trim()) value.facebook_url = marketing.facebook_url
            }
        } catch (err) {
            console.error('[loadMarketing] failed, using defaults:', err)
        }
    }

    cache = { value, expires: now + TTL_MS }
    return value
}

/** Convenience getter for the most common consumer (review request flow). */
export async function getGoogleReviewLink(supabase?: SupabaseClient): Promise<string> {
    return (await getMarketingConfig(supabase)).google_review_link
}
