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
  cachedAt?: string         // ISO timestamp del payload servito da cache
  fromCache?: boolean       // true se serviamo cache, false se appena fetchato
}

// La GBP API ha quota molto stretta (errori "Requests per minute" tipici
// gia' al secondo refresh). Cachiamo il payload in app_secrets per 30 min
// e l'ID location forever (non cambia mai). Cosi' aprendo/chiudendo la tab
// piu' volte di fila non bruciamo la quota.
const REPORT_CACHE_TTL_MS = 30 * 60 * 1000  // 30 minuti

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

  const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const force = event.queryStringParameters?.refresh === '1'

  // 1) CACHE LOOKUP: prima di chiamare Google guardiamo app_secrets per
  //    un payload recente (<30 min). Una riga per range cosi' 7d/28d/90d
  //    non si scambiano. Salta se ?refresh=1 (bottone "ricarica" nella UI).
  const cacheKey = `gbp_report_cache_${range}`
  if (!force) {
    try {
      const { data } = await sb.from('app_secrets').select('value, updated_at').eq('key', cacheKey).maybeSingle()
      const cached = data?.value as (GbpPayload & { fetchedAt?: string }) | undefined
      const fetchedAt = cached?.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0
      if (cached && Date.now() - fetchedAt < REPORT_CACHE_TTL_MS) {
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ ...cached, fromCache: true, cachedAt: cached.fetchedAt })
        }
      }
    } catch { /* cache miss = fall through al fetch */ }
  }

  // 2) Refresh token
  let refreshToken: string | undefined
  try {
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

  // 3) LOCATION CACHE: la location ID di DR7 non cambia mai. Cachiamo
  //    forever in app_secrets dopo la prima scoperta. Risparmia 2
  //    chiamate API per request (accounts.list + locations.list), che
  //    sono PROPRIO quelle che fanno scattare il rate limit
  //    "mybusinessaccountmanagement.googleapis.com Requests per minute".
  let locationName: string | undefined
  try {
    const { data: locCache } = await sb.from('app_secrets').select('value').eq('key', 'gbp_location_name').maybeSingle()
    locationName = (locCache?.value as any)?.name
  } catch { /* fall through alla scoperta */ }

  if (!locationName) {
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
      locationName = loc.name

      // Salva in cache forever (chiave separata da quella del report)
      try {
        await sb.from('app_secrets').upsert({
          key: 'gbp_location_name',
          value: { name: locationName, title: loc.title || null, discovered_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' })
      } catch { /* salvataggio cache best-effort */ }
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
    const fetchedAt = new Date().toISOString()
    const payload: GbpPayload & { fetchedAt: string } = { configured: true, range, kpis, warnings: [], fetchedAt }

    // Cache server-side per 30 min: i prossimi refresh non chiamano Google.
    try {
      await sb.from('app_secrets').upsert({
        key: cacheKey,
        value: payload,
        updated_at: fetchedAt,
      }, { onConflict: 'key' })
    } catch { /* cache write best-effort */ }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ...payload, fromCache: false, cachedAt: fetchedAt })
    }
  } catch (e: any) {
    const msg = String(e?.message || e)
    const isQuota = /quota|rate.?limit|too.?many|RESOURCE_EXHAUSTED|429/i.test(msg)

    // Quando Google ritorna quota exceeded, proviamo a servire l'ultimo
    // payload cached (anche se piu' vecchio di 30 min) — meglio numeri
    // vecchi di 1 ora che una tab vuota con un errore tecnico illeggibile.
    if (isQuota) {
      try {
        const { data: stale } = await sb.from('app_secrets').select('value').eq('key', cacheKey).maybeSingle()
        const cached = stale?.value as (GbpPayload & { fetchedAt?: string }) | undefined
        if (cached?.kpis) {
          const cachedAt = cached.fetchedAt || ''
          const minsOld = cachedAt ? Math.round((Date.now() - new Date(cachedAt).getTime()) / 60000) : 0
          return {
            statusCode: 200, headers,
            body: JSON.stringify({
              ...cached, fromCache: true, cachedAt,
              warnings: [`Quota Google temporaneamente esaurita — mostro dati cache di ${minsOld} min fa. Riprova tra qualche minuto per aggiornare.`]
            })
          }
        }
      } catch { /* nessuna cache da servire */ }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ...empty, configured: true,
        warnings: [
          isQuota
            ? 'Quota Google esaurita (limite richieste/minuto). Riprova tra 60-120 secondi — la GBP API ha quote molto strette.'
            : `Errore Performance API: ${msg}`
        ]
      })
    }
  }
}

export { handler }
