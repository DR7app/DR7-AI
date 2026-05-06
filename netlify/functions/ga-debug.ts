import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Endpoint diagnostico per capire perche' ga-report non pesca i dati
 * GA4. Mostra: env vars presenti (senza valori), stato app_secrets,
 * presenza refresh_token. Pubblico ma non rivela credenziali.
 *
 * Da eliminare dopo aver risolto il problema.
 */
const handler: Handler = async () => {
    const out: any = {
        env: {
            GA4_PROPERTY_ID: !!process.env.GA4_PROPERTY_ID,
            GA4_CLIENT_EMAIL: !!process.env.GA4_CLIENT_EMAIL,
            GA4_PRIVATE_KEY: !!process.env.GA4_PRIVATE_KEY,
            GA4_SERVICE_ACCOUNT_JSON: !!process.env.GA4_SERVICE_ACCOUNT_JSON,
            GOOGLE_OAUTH_CLIENT_ID: !!process.env.GOOGLE_OAUTH_CLIENT_ID,
            GOOGLE_OAUTH_CLIENT_SECRET: !!process.env.GOOGLE_OAUTH_CLIENT_SECRET,
            GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI || null,
            GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
            VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
        appSecretsTable: { exists: false, rows: 0, error: null as string | null, hasOAuthToken: false },
    }

    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (url && key) {
        try {
            const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
            const { data, error } = await sb
                .from('app_secrets')
                .select('key, updated_at')
                .order('updated_at', { ascending: false })
            if (error) {
                out.appSecretsTable.error = error.message + ' [code: ' + error.code + ']'
            } else {
                out.appSecretsTable.exists = true
                out.appSecretsTable.rows = (data || []).length
                out.appSecretsTable.keys = (data || []).map((r: any) => ({ key: r.key, updated_at: r.updated_at }))
                out.appSecretsTable.hasOAuthToken = (data || []).some((r: any) => r.key === 'ga4_oauth_refresh_token')
            }
        } catch (e) {
            out.appSecretsTable.error = e instanceof Error ? e.message : String(e)
        }
    }

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(out, null, 2),
    }
}

export { handler }
