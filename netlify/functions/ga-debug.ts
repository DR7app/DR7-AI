import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

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

    // Test the actual GA call with OAuth to see what fails
    out.gaCallTest = { attempted: false, success: false, error: null as string | null, sampleData: null as any }
    const propertyId = process.env.GA4_PROPERTY_ID
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
    if (url && key && propertyId && clientId && clientSecret) {
        try {
            const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
            const { data: tokenRow } = await sb
                .from('app_secrets')
                .select('value')
                .eq('key', 'ga4_oauth_refresh_token')
                .maybeSingle()
            const refreshToken = (tokenRow?.value as any)?.refresh_token
            if (!refreshToken) {
                out.gaCallTest.error = 'no refresh_token in app_secrets'
            } else {
                out.gaCallTest.attempted = true
                const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
                oauth2.setCredentials({ refresh_token: refreshToken })
                const analytics = google.analyticsdata({ version: 'v1beta', auth: oauth2 as any })
                const resp = await analytics.properties.runReport({
                    property: `properties/${propertyId}`,
                    requestBody: {
                        dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
                        metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }, { name: 'totalUsers' }],
                    },
                })
                out.gaCallTest.success = true
                out.gaCallTest.sampleData = {
                    rowCount: resp.data.rowCount,
                    metricHeaders: resp.data.metricHeaders?.map((m: any) => m.name),
                    firstRow: resp.data.rows?.[0]?.metricValues?.map((v: any) => v.value),
                    propertyQuota: resp.data.propertyQuota || null,
                }
            }
        } catch (e: any) {
            out.gaCallTest.error = (e?.message || String(e)) + (e?.code ? ` [code: ${e.code}]` : '')
        }
    } else {
        out.gaCallTest.error = 'missing required env vars'
    }

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(out, null, 2),
    }
}

export { handler }
