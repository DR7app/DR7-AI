import type { Handler } from '@netlify/functions'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

/**
 * Google Business Profile Performance Report.
 * Mostra le metriche del profilo Google ("DR7 Cagliari" sulla scheda
 * Google Maps/Search): visualizzazioni, chiamate, richieste indicazioni,
 * click al sito, click messaggio.
 *
 * Usa lo STESSO refresh_token OAuth gia' salvato per GA4 (l'admin deve
 * aver autorizzato anche lo scope business.manage — se ha autorizzato
 * solo analytics.readonly serve riconnettere).
 *
 * API docs: https://developers.google.com/my-business/reference/performance/rest
 */

interface GbpKpis {
  views: number               // BUSINESS_IMPRESSIONS_DESKTOP_MAPS+...+MOBILE
  calls: number               // CALL_CLICKS
  directions: number          // BUSINESS_DIRECTION_REQUESTS
  websiteClicks: number       // WEBSITE_CLICKS
  bookings: number            // BUSINESS_BOOKINGS (where supported)
}

interface GbpPayload {
  configured: boolean
  range: string
  kpis: GbpKpis | null
  warnings: string[]
  needsReauth?: boolean
  noLocationFound?: boolean
}

function dateMinusDays(days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.now() - days * 86400000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}
function todayUTC(): { year: number; month: number; day: number } {
  const d = new Date()
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

const handler: Handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const range = (event.queryStringParameters?.range || '28d')
  const days = range === '7d' ? 7 : range === '90d' ? 90 : range === '180d' ? 180 : range === '365d' ? 365 : 28

  const empty: GbpPayload = { configured: false, range, kpis: null, warnings: [] }

  // Carica refresh_token e env vars OAuth
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET

  if (!supabaseUrl || !supabaseKey || !clientId || !clientSecret) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ...empty, warnings: ['OAuth o Supabase non configurati'] })
    }
  }

  let refreshToken: string | undefined
  try {
    const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data } = await sb.from('app_secrets').select('value').eq('key', 'ga4_oauth_refresh_token').maybeSingle()
    refreshToken = (data?.value as any)?.refresh_token
  } catch (e) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ...empty, warnings: [`Lookup token fallito: ${e instanceof Error ? e.message : String(e)}`] })
    }
  }

  if (!refreshToken) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ...empty, warnings: ['Nessun refresh_token: connetti l\'account Google da Rendimento Sito'] })
    }
  }

  // OAuth client + token
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({ refresh_token: refreshToken })

  // 1) Trova le location (business profiles) che l'utente possiede.
  // Account Management API → accounts.locations.list
  // Se l'utente non ha mai concesso scope business.manage, qui scatta 403.
  let locationName: string | undefined
  try {
    // Step A: lista account
    const accountsRes = await oauth2.request<{ accounts: Array<{ name: string }> }>({
      url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      method: 'GET',
    })
    const account = accountsRes.data.accounts?.[0]
    if (!account?.name) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ...empty, configured: true, noLocationFound: true, warnings: ['Nessun account Google Business Profile collegato a questo Google account'] })
      }
    }

    // Step B: lista locations dell'account
    const locsRes = await oauth2.request<{ locations: Array<{ name: string; title?: string }> }>({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
      method: 'GET',
    })
    const loc = locsRes.data.locations?.[0]
    if (!loc?.name) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ...empty, configured: true, noLocationFound: true, warnings: ['Nessuna location nel profilo Business'] })
      }
    }
    // I name di location sono "locations/12345"; estrai l'ID per il Performance API
    locationName = loc.name
  } catch (e: any) {
    const msg = String(e?.message || e)
    const needsReauth = /insufficient|invalid_scope|forbidden|403/i.test(msg)
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ...empty, configured: true, needsReauth,
        warnings: [`Errore Business Profile API: ${msg}`,
          needsReauth ? 'Lo scope business.manage non e\' stato autorizzato — riconnetti l\'account Google.' : '']
          .filter(Boolean),
      })
    }
  }

  // 2) Performance metrics — fetchMultiDailyMetricsTimeSeries
  // doc: https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries
  const start = dateMinusDays(days)
  const end = todayUTC()
  const metrics = [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'CALL_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'WEBSITE_CLICKS',
    'BUSINESS_BOOKINGS',
  ]
  try {
    const params = new URLSearchParams()
    metrics.forEach(m => params.append('dailyMetrics', m))
    params.append('dailyRange.start_date.year', String(start.year))
    params.append('dailyRange.start_date.month', String(start.month))
    params.append('dailyRange.start_date.day', String(start.day))
    params.append('dailyRange.end_date.year', String(end.year))
    params.append('dailyRange.end_date.month', String(end.month))
    params.append('dailyRange.end_date.day', String(end.day))

    const url = `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`
    const r = await oauth2.request<{ multiDailyMetricTimeSeries: Array<{ dailyMetricTimeSeries: Array<{ dailyMetric: string; timeSeries: { datedValues: Array<{ value?: string }> } }> }> }>({
      url, method: 'GET',
    })

    const sums: Record<string, number> = {}
    for (const m of metrics) sums[m] = 0
    const series = r.data.multiDailyMetricTimeSeries?.[0]?.dailyMetricTimeSeries || []
    for (const s of series) {
      const total = (s.timeSeries.datedValues || []).reduce((acc, v) => acc + Number(v.value || 0), 0)
      sums[s.dailyMetric] = total
    }
    const views =
      (sums.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) +
      (sums.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) +
      (sums.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0) +
      (sums.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0)
    const kpis: GbpKpis = {
      views,
      calls: sums.CALL_CLICKS || 0,
      directions: sums.BUSINESS_DIRECTION_REQUESTS || 0,
      websiteClicks: sums.WEBSITE_CLICKS || 0,
      bookings: sums.BUSINESS_BOOKINGS || 0,
    }
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ configured: true, range, kpis, warnings: [] } satisfies GbpPayload)
    }
  } catch (e: any) {
    const msg = String(e?.message || e)
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ...empty, configured: true, warnings: [`Errore Performance API: ${msg}`] })
    }
  }
}

export { handler }
