import type { Handler } from '@netlify/functions'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

/**
 * Callback OAuth: Google ci ridirige qui con ?code=... dopo che
 * l'admin ha approvato il consenso. Scambiamo il codice per i token
 * (access_token + refresh_token) e salviamo il refresh_token nella
 * tabella app_secrets sotto la chiave 'ga4_oauth_refresh_token'.
 *
 * Da quel momento ga-report puo' usare il refresh_token per chiamare
 * GA Data API come se fosse l'admin connesso.
 */

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI
    || (process.env.URL ? `${process.env.URL}/.netlify/functions/ga-oauth-callback` : undefined)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const handler: Handler = async (event) => {
    const code = event.queryStringParameters?.code
    const error = event.queryStringParameters?.error

    if (error) {
        return {
            statusCode: 302,
            headers: { Location: `/admin?ga_oauth_error=${encodeURIComponent(error)}` },
            body: '',
        }
    }

    if (!code) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing authorization code' }) }
    }

    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
        return { statusCode: 500, body: JSON.stringify({ error: 'OAuth env vars not configured' }) }
    }

    try {
        const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
        const { tokens } = await oauth.getToken(code)

        if (!tokens.refresh_token) {
            // Rara: succede se l'utente aveva gia' autorizzato e il prompt
            // non e' stato re-richiesto. Ma noi forziamo prompt=consent quindi
            // dovrebbe sempre arrivare.
            return {
                statusCode: 302,
                headers: { Location: '/admin?ga_oauth_error=no_refresh_token' },
                body: '',
            }
        }

        // Recupero email dell'utente per metterla nel record
        oauth.setCredentials(tokens)
        const userInfo = await google.oauth2('v2').userinfo.get({ auth: oauth }).catch(() => null)
        const email = userInfo?.data?.email || 'unknown'

        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        const { error: upsertErr } = await sb
            .from('app_secrets')
            .upsert({
                key: 'ga4_oauth_refresh_token',
                value: {
                    refresh_token: tokens.refresh_token,
                    email,
                    obtained_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
            }, { onConflict: 'key' })

        if (upsertErr) {
            console.error('[ga-oauth-callback] upsert error:', upsertErr)
            return {
                statusCode: 302,
                headers: { Location: `/admin?ga_oauth_error=${encodeURIComponent('save_failed: ' + upsertErr.message)}` },
                body: '',
            }
        }

        return {
            statusCode: 302,
            headers: { Location: '/admin?ga_oauth=connected' },
            body: '',
        }
    } catch (err: any) {
        console.error('[ga-oauth-callback] error:', err)
        return {
            statusCode: 302,
            headers: { Location: `/admin?ga_oauth_error=${encodeURIComponent(err?.message || 'unknown')}` },
            body: '',
        }
    }
}

export { handler }
