import { Handler } from '@netlify/functions'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

// Fetches the data backing the "Rendimento Sito" tab from Google Analytics 4.
// Returns ONLY real numbers. If env vars are missing, returns a structured
// `configured: false` response so the UI can list what to set up.

interface SeriesPoint { day: string; organico: number; ads: number; maps: number }
interface ChannelSlice { name: string; value: number }
interface FunnelStage { stage: string; value: number }
interface TopPage { page: string; sessions: number; pageviews: number }
interface KpiBlock {
  visits: number
  pageviews: number
  users: number
  bookings: number    // GA4 conversion event "booking_completed" — 0 until configured
  calls: number       // event "phone_call" — 0 until configured
  revenue: number     // GA4 ecommerce purchase value — 0 until configured
  delta_visits: number
  delta_pageviews: number
  delta_users: number
}

interface ReportPayload {
  configured: boolean
  missing: string[]
  range: '7d' | '28d' | '90d'
  kpis: KpiBlock | null
  traffic: SeriesPoint[]
  distribution: ChannelSlice[]
  funnel: FunnelStage[]
  topPages: TopPage[]
  fetchedAt: string
  warnings: string[]
  // Quando l'API risponde 403 PERMISSION_DENIED valorizziamo questo blocco
  // cosi' la UI puo' mostrare istruzioni mirate (aggiungere il
  // service account email come Viewer in GA4 → Property Access Management).
  permissionIssue?: {
    serviceAccountEmail: string
    propertyId: string
  } | null
}

function rangeToDates(range: string): { startDate: string; endDate: string; prevStart: string; prevEnd: string } {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 28
  return {
    startDate: `${days}daysAgo`,
    endDate: 'today',
    prevStart: `${days * 2}daysAgo`,
    prevEnd: `${days + 1}daysAgo`,
  }
}

function pct(curr: number, prev: number): number {
  if (!prev) return 0
  return ((curr - prev) / prev) * 100
}

function isoDateFromGa(s: string): string {
  // GA returns YYYYMMDD
  if (!/^\d{8}$/.test(s)) return s
  return `${s.slice(6, 8)}/${s.slice(4, 6)}`
}

const handler: Handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const range = (event.queryStringParameters?.range || '28d') as '7d' | '28d' | '90d'

  const propertyId = process.env.GA4_PROPERTY_ID
  // Three credential sources, in priority order. The first two stay as
  // fallback for setups that fit under AWS Lambda's 4KB env cap; the
  // third (Netlify Blobs) is what we use on DR7 because the existing
  // env vars + the ~1.7KB private key push us over the limit.
  //   A) GA4_SERVICE_ACCOUNT_JSON env  (full JSON, ~2.3KB)
  //   B) GA4_CLIENT_EMAIL + GA4_PRIVATE_KEY env  (~1.8KB)
  //   C) Netlify Blobs store="ga4" key="creds"   (no env footprint)
  const credsRaw = process.env.GA4_SERVICE_ACCOUNT_JSON
  const splitEmail = process.env.GA4_CLIENT_EMAIL
  const splitKey = process.env.GA4_PRIVATE_KEY

  let blobEmail: string | undefined
  let blobKey: string | undefined
  // Read GA creds from Supabase app_secrets (persistent storage that
  // doesn't count against the 4KB Lambda env-var cap).
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data } = await supabase
        .from('app_secrets')
        .select('value')
        .eq('key', 'ga4_creds')
        .maybeSingle()
      if (data?.value) {
        const v = data.value as { privateKey?: string; clientEmail?: string }
        blobKey = v.privateKey || undefined
        blobEmail = v.clientEmail || undefined
      }
    } catch { /* table may not exist yet */ }
  }

  const hasFull = !!credsRaw
  const hasSplit = !!splitEmail && !!splitKey
  const hasBlob = !!blobKey

  const missing: string[] = []
  if (!propertyId) missing.push('GA4_PROPERTY_ID')
  if (!hasFull && !hasSplit && !hasBlob) {
    missing.push('credenziali GA4 (chiama POST /.netlify/functions/ga-setup-key per caricarle in Netlify Blobs, oppure imposta GA4_CLIENT_EMAIL+GA4_PRIVATE_KEY)')
  }

  const empty: ReportPayload = {
    configured: false,
    missing,
    range,
    kpis: null,
    traffic: [],
    distribution: [],
    funnel: [],
    topPages: [],
    fetchedAt: new Date().toISOString(),
    warnings: [],
  }

  if (missing.length > 0) {
    return { statusCode: 200, headers, body: JSON.stringify(empty) }
  }

  let clientEmail: string | undefined
  let privateKey: string | undefined
  if (hasFull) {
    try {
      const j = JSON.parse(credsRaw!)
      clientEmail = j.client_email
      privateKey = j.private_key
    } catch {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ...empty, warnings: ['GA4_SERVICE_ACCOUNT_JSON non è un JSON valido'] }),
      }
    }
  } else if (hasSplit) {
    clientEmail = splitEmail
    privateKey = splitKey?.replace(/\\n/g, '\n')
  } else {
    // From Netlify Blobs (preferred for DR7).
    clientEmail = blobEmail || splitEmail
    privateKey = blobKey
  }

  if (!clientEmail || !privateKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ...empty, warnings: ['client_email o private_key mancanti dopo il parsing'] }),
    }
  }

  try {
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    })
    const analytics = google.analyticsdata({ version: 'v1beta', auth })

    const dates = rangeToDates(range)
    const property = `properties/${propertyId}`

    // Run all queries in parallel
    const [kpiCurr, kpiPrev, byDay, byChannel, byPage, conversions] = await Promise.all([
      analytics.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: dates.startDate, endDate: dates.endDate }],
          metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }, { name: 'totalUsers' }],
        },
      }),
      analytics.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: dates.prevStart, endDate: dates.prevEnd }],
          metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }, { name: 'totalUsers' }],
        },
      }),
      analytics.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: dates.startDate, endDate: dates.endDate }],
          dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        },
      }),
      analytics.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: dates.startDate, endDate: dates.endDate }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '10',
        },
      }),
      analytics.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: dates.startDate, endDate: dates.endDate }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '10',
        },
      }),
      analytics.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: dates.startDate, endDate: dates.endDate }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }, { name: 'totalRevenue' }],
        },
      }),
    ])

    // KPI block
    const cR = kpiCurr.data.rows?.[0]?.metricValues || []
    const pR = kpiPrev.data.rows?.[0]?.metricValues || []
    const num = (m: { value?: string | null }[] | undefined, i: number) => Number(m?.[i]?.value || 0)
    const sessions = num(cR, 0)
    const pageviews = num(cR, 1)
    const users = num(cR, 2)
    const prevSessions = num(pR, 0)
    const prevPageviews = num(pR, 1)
    const prevUsers = num(pR, 2)

    // Conversions / phone clicks / revenue from event names — 0 until events are wired
    let bookings = 0, calls = 0, revenue = 0
    for (const row of conversions.data.rows || []) {
      const name = row.dimensionValues?.[0]?.value || ''
      const count = Number(row.metricValues?.[0]?.value || 0)
      const value = Number(row.metricValues?.[1]?.value || 0)
      if (name === 'booking_completed' || name === 'purchase') bookings += count
      if (name === 'phone_call' || name === 'click_to_call') calls += count
      if (name === 'purchase' || name === 'booking_completed') revenue += value
    }

    const kpis: KpiBlock = {
      visits: sessions,
      pageviews,
      users,
      bookings,
      calls,
      revenue,
      delta_visits: pct(sessions, prevSessions),
      delta_pageviews: pct(pageviews, prevPageviews),
      delta_users: pct(users, prevUsers),
    }

    // Distribution by channel
    const distribution: ChannelSlice[] = (byChannel.data.rows || []).map(r => ({
      name: r.dimensionValues?.[0]?.value || '(Other)',
      value: Number(r.metricValues?.[0]?.value || 0),
    }))

    // Daily series — pivot by channel into Organic/Paid/Social etc.
    // We bucket: "Organic Search" → organico, "Paid Search"/"Display"/"Paid Social" → ads, "Organic Map" → maps
    const dayMap = new Map<string, SeriesPoint>()
    for (const row of byDay.data.rows || []) {
      const day = isoDateFromGa(row.dimensionValues?.[0]?.value || '')
      const channel = row.dimensionValues?.[1]?.value || ''
      const sess = Number(row.metricValues?.[0]?.value || 0)
      let key: 'organico' | 'ads' | 'maps' | null = null
      const c = channel.toLowerCase()
      if (c.includes('organic search')) key = 'organico'
      else if (c.includes('paid') || c.includes('display') || c.includes('cpc')) key = 'ads'
      else if (c.includes('map')) key = 'maps'
      if (!key) continue
      const existing = dayMap.get(day) || { day, organico: 0, ads: 0, maps: 0 }
      existing[key] += sess
      dayMap.set(day, existing)
    }
    const traffic: SeriesPoint[] = Array.from(dayMap.values())

    // Top pages
    const topPages: TopPage[] = (byPage.data.rows || []).map(r => ({
      page: r.dimensionValues?.[0]?.value || '/',
      sessions: Number(r.metricValues?.[0]?.value || 0),
      pageviews: Number(r.metricValues?.[1]?.value || 0),
    }))

    // Funnel — only fillable when conversion events exist in GA4
    const funnel: FunnelStage[] = [
      { stage: 'Visite',          value: sessions },
      { stage: 'Pagine viste',    value: pageviews },
      { stage: 'Click telefono',  value: calls },
      { stage: 'Prenotazioni',    value: bookings },
    ]

    const warnings: string[] = []
    if (sessions === 0) warnings.push('Nessuna visita registrata nel periodo selezionato — verifica che lo snippet GA4 sia attivo su dr7empire.com.')
    if (bookings === 0 && calls === 0) warnings.push('Nessun evento di conversione (booking_completed, phone_call) tracciato in GA4. Aggiungi gtag("event", "booking_completed", {value:...}) sui form di prenotazione per vederli qui.')

    const payload: ReportPayload = {
      configured: true,
      missing: [],
      range,
      kpis,
      traffic,
      distribution,
      funnel,
      topPages,
      fetchedAt: new Date().toISOString(),
      warnings,
    }

    return { statusCode: 200, headers, body: JSON.stringify(payload) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ga-report] error:', err)
    // configured = credentials are loaded (any of the 3 sources) AND we have a
    // property ID. Distinct from "API call worked" — that's reported via
    // warnings. Without this distinction, the page wrongly shows "Configurazione
    // richiesta" whenever the GA Data API itself errors out.
    const credsLoaded = !!clientEmail && !!privateKey
    const errMsg = err?.message || String(err)
    // PERMISSION_DENIED 403: il service account NON e' stato aggiunto
    // come Viewer/Analyst nella property GA4. Lo intercettiamo per dare
    // istruzioni operative invece di un messaggio API criptico.
    const isPermissionError = /sufficient permissions|PERMISSION_DENIED|permission_denied|403/i.test(errMsg)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...empty,
        configured: !!propertyId && credsLoaded,
        warnings: [`Errore Google Analytics Data API: ${errMsg}`],
        permissionIssue: isPermissionError && clientEmail && propertyId
          ? { serviceAccountEmail: clientEmail, propertyId }
          : null,
      }),
    }
  }
}

export { handler }
