import type { Handler } from '@netlify/functions'
import { google } from 'googleapis'

/**
 * Avvia il flusso OAuth Google per autorizzare l'accesso ai dati GA4
 * usando l'account dell'admin (es. dubai.rent7.0srl@gmail.com).
 *
 * Workflow:
 *  1. Admin clicca "Connetti Google" in Rendimento Sito → browser
 *     viene reindirizzato qui (GET).
 *  2. Generiamo l'URL di consenso Google e ridirigiamo il browser li'.
 *  3. Google autentica l'admin e poi reindirizza a ga-oauth-callback
 *     con il codice di autorizzazione.
 *
 * `prompt: 'consent'` e `access_type: 'offline'` insieme garantiscono
 * di ricevere SEMPRE un refresh_token (anche su riconnessioni).
 */

// Riusiamo gli OAuth client gia' configurati per altre integrazioni Google
// (Calendar, ecc.) cosi' non serve aggiungere nuove env var. Cerchiamo in
// ordine: GOOGLE_OAUTH_* (specifico) → GOOGLE_* (condiviso, gia' presente).
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI
    || (process.env.URL ? `${process.env.URL}/.netlify/functions/ga-oauth-callback` : undefined)

const handler: Handler = async () => {
    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'OAuth non configurato',
                missing: [
                    !CLIENT_ID && 'GOOGLE_OAUTH_CLIENT_ID',
                    !CLIENT_SECRET && 'GOOGLE_OAUTH_CLIENT_SECRET',
                    !REDIRECT_URI && 'GOOGLE_OAUTH_REDIRECT_URI',
                ].filter(Boolean),
            }),
        }
    }

    const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
    const url = oauth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/analytics.readonly'],
        include_granted_scopes: true,
    })

    return {
        statusCode: 302,
        headers: { Location: url },
        body: '',
    }
}

export { handler }
