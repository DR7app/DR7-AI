import type { Handler } from '@netlify/functions'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

/**
 * Diagnostic della connessione Google Business Profile.
 * Risponde a "perche' la tab Rendimento Google My Business non funziona":
 * - quali env vars sono presenti
 * - quale account Google e' connesso (email)
 * - quando il refresh_token e' stato ottenuto
 * - quali scope sono autorizzati (decoded dal token)
 * - se la location e' gia' in cache
 * - se la prima chiamata accounts.list risponde 200 / 403 / 429
 */

interface Diag {
  envs: {
    SUPABASE_URL: boolean
    SUPABASE_SERVICE_ROLE_KEY: boolean
    GOOGLE_CLIENT_ID: boolean
    GOOGLE_CLIENT_SECRET: boolean
  }
  oauth: {
    refresh_token_present: boolean
    connected_email: string | null
    obtained_at: string | null
    scopes_in_access_token: string[] | null
    access_token_test: 'ok' | 'failed' | null
    access_token_error: string | null
  }
  location_cache: {
    name: string | null
    title: string | null
    discovered_at: string | null
  }
  report_caches: { range: string; fetchedAt: string | null }[]
  accounts_test: {
    status: 'ok' | 'failed' | 'skipped'
    accounts_found: number
    error: string | null
    error_classification: 'quota' | 'auth' | 'scope' | 'other' | null
  }
  recommendations: string[]
}

const handler: Handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }

  const envs = {
    SUPABASE_URL: !!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_CLIENT_ID: !!(process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: !!(process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET),
  }

  const diag: Diag = {
    envs,
    oauth: {
      refresh_token_present: false,
      connected_email: null,
      obtained_at: null,
      scopes_in_access_token: null,
      access_token_test: null,
      access_token_error: null,
    },
    location_cache: { name: null, title: null, discovered_at: null },
    report_caches: [],
    accounts_test: { status: 'skipped', accounts_found: 0, error: null, error_classification: null },
    recommendations: [],
  }

  // Verifica env vars
  if (!envs.SUPABASE_URL || !envs.SUPABASE_SERVICE_ROLE_KEY) {
    diag.recommendations.push('Mancano env vars Supabase su Netlify (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
    return { statusCode: 200, headers, body: JSON.stringify(diag) }
  }
  if (!envs.GOOGLE_CLIENT_ID || !envs.GOOGLE_CLIENT_SECRET) {
    diag.recommendations.push('Mancano env vars Google OAuth su Netlify (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)')
    return { statusCode: 200, headers, body: JSON.stringify(diag) }
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)!
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)!
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // Refresh token + email
  try {
    const { data } = await sb.from('app_secrets').select('value').eq('key', 'ga4_oauth_refresh_token').maybeSingle()
    const v = data?.value as { refresh_token?: string; email?: string; obtained_at?: string } | undefined
    diag.oauth.refresh_token_present = !!v?.refresh_token
    diag.oauth.connected_email = v?.email || null
    diag.oauth.obtained_at = v?.obtained_at || null
  } catch (e) {
    diag.oauth.access_token_error = `Lookup refresh_token fallito: ${e instanceof Error ? e.message : String(e)}`
  }

  if (!diag.oauth.refresh_token_present) {
    diag.recommendations.push('Nessun refresh_token salvato — apri Rendimento Sito e clicca "Connetti Google"')
    return { statusCode: 200, headers, body: JSON.stringify(diag) }
  }

  // Test refresh: scambia refresh_token per access_token e leggi scope autorizzati
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({ refresh_token: undefined })
  try {
    const { data: rt } = await sb.from('app_secrets').select('value').eq('key', 'ga4_oauth_refresh_token').maybeSingle()
    const refreshToken = (rt?.value as { refresh_token?: string } | undefined)?.refresh_token
    if (!refreshToken) throw new Error('refresh_token vuoto in app_secrets')
    oauth2.setCredentials({ refresh_token: refreshToken })
    const tokenRes = await oauth2.getAccessToken()
    if (!tokenRes.token) throw new Error('access_token vuoto dopo refresh')

    // Leggi gli scope correnti chiamando tokeninfo (gratuito, niente quota)
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tokenRes.token)}`)
    if (infoRes.ok) {
      const info = await infoRes.json() as { scope?: string; expires_in?: string }
      diag.oauth.scopes_in_access_token = (info.scope || '').split(/\s+/).filter(Boolean)
    }
    diag.oauth.access_token_test = 'ok'
  } catch (e: any) {
    diag.oauth.access_token_test = 'failed'
    diag.oauth.access_token_error = String(e?.message || e)
    diag.recommendations.push('Il refresh del token Google fallisce — riconnetti l\'account in Rendimento Sito')
    return { statusCode: 200, headers, body: JSON.stringify(diag) }
  }

  // Scope check: serve business.manage
  const hasBusinessScope = diag.oauth.scopes_in_access_token?.some(s =>
    s.includes('business.manage') || s.includes('plus.business.manage')
  )
  if (!hasBusinessScope) {
    diag.recommendations.push(
      'Lo scope "business.manage" NON e\' tra quelli autorizzati. Quando hai connesso Google probabilmente hai dato solo i permessi GA4. ' +
      'Vai su Rendimento Sito → Disconnetti Google → Riconnetti, e nella pagina dei permessi spunta "Gestisci la tua scheda di Google Business".'
    )
  }

  // Location cache
  try {
    const { data } = await sb.from('app_secrets').select('value').eq('key', 'gbp_location_name').maybeSingle()
    const v = data?.value as { name?: string; title?: string; discovered_at?: string } | undefined
    diag.location_cache = { name: v?.name || null, title: v?.title || null, discovered_at: v?.discovered_at || null }
  } catch { /* niente cache location */ }

  // Report caches per range
  for (const range of ['7d', '28d', '90d', '180d', '365d']) {
    try {
      const { data } = await sb.from('app_secrets').select('value').eq('key', `gbp_report_cache_${range}`).maybeSingle()
      const v = data?.value as { fetchedAt?: string } | undefined
      diag.report_caches.push({ range, fetchedAt: v?.fetchedAt || null })
    } catch { /* skip */ }
  }

  // Test reale: chiama accounts.list UNA volta e classifica l'errore
  if (hasBusinessScope) {
    try {
      const r = await oauth2.request<{ accounts?: Array<{ name: string }> }>({
        url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
        method: 'GET',
      })
      diag.accounts_test.status = 'ok'
      diag.accounts_test.accounts_found = r.data.accounts?.length || 0
      if (!r.data.accounts?.length) {
        diag.recommendations.push(
          `L'account Google ${diag.oauth.connected_email} non possiede NESSUN profilo Google Business. ` +
          `Verifica di aver connesso l'account giusto (quello che gestisce DR7 Cagliari su Google Maps).`
        )
      }
    } catch (e: any) {
      const msg = String(e?.message || e)
      diag.accounts_test.status = 'failed'
      diag.accounts_test.error = msg
      if (/quota|rate.?limit|RESOURCE_EXHAUSTED|429/i.test(msg)) {
        diag.accounts_test.error_classification = 'quota'
        diag.recommendations.push('Quota esaurita ORA — attendi 60-120 secondi e ricarica questa diagnostica. La connessione e\' valida.')
      } else if (/insufficient.*scope|invalid_scope/i.test(msg)) {
        diag.accounts_test.error_classification = 'scope'
        diag.recommendations.push('Lo scope business.manage manca — riconnetti Google e autorizza "Gestisci la tua scheda di Google Business".')
      } else if (/invalid_grant|unauthorized|401|403/i.test(msg)) {
        diag.accounts_test.error_classification = 'auth'
        diag.recommendations.push('Auth invalida — il refresh_token e\' stato revocato. Riconnetti l\'account Google.')
      } else {
        diag.accounts_test.error_classification = 'other'
      }
    }
  } else {
    diag.accounts_test.status = 'skipped'
    diag.accounts_test.error = 'Skipped — scope business.manage mancante'
  }

  if (diag.recommendations.length === 0) {
    diag.recommendations.push('Connessione OK. Se non vedi dati, controlla che la location trovata sia DR7 Cagliari.')
  }

  return { statusCode: 200, headers, body: JSON.stringify(diag) }
}

export { handler }
