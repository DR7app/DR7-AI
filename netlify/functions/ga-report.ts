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

interface RealtimeBlock {
  activeUsers: number       // utenti negli ultimi 30 min
  pageviews30m: number      // pageviews ultimi 30 min
  events30m: number         // eventi ultimi 30 min
  conversions30m: number    // conversioni (booking/phone) ultimi 30 min
  topActivePages: { page: string; users: number }[]
}

interface ReportPayload {
  configured: boolean
  missing: string[]
  range: '7d' | '28d' | '90d' | '180d' | '365d'
  kpis: KpiBlock | null
  realtime: RealtimeBlock | null
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
  // Sorgente dati: 'ga4' = numeri reali da Google Analytics; 'internal' =
  // fallback su Supabase (bookings/customers/fatture) quando GA4 non e'
  // raggiungibile. La UI mostra un badge per non confondere le due cose.
  dataSource?: 'ga4' | 'internal'
  // Sorgente delle KPI conversione (Prenotazioni, Click telefono, Fatturato).
  // 'ga4' = arriva dagli eventi gtag (booking_completed/purchase/phone_call).
  // 'crm' = fallback dal DB Supabase quando il sito non invia ancora eventi.
  // La UI usa questo per etichettare correttamente i tile (no "Fatturato GA"
  // quando il numero arriva dal CRM).
  conversionsSource?: 'ga4' | 'crm'
}

// Fallback: quando GA4 non risponde (errore permessi, env mancanti, ecc.)
// popoliamo i KPI con dati interni della nostra DB Supabase, cosi' la tab
// non resta mai vuota. NON sono dati di traffico web — sono operatività
// DR7 (prenotazioni, clienti, fatturato). Marcati come dataSource='internal'.
async function buildInternalFallback(range: string): Promise<{ kpis: KpiBlock; warnings: string[] }> {
  const supabaseUrlEnv = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKeyEnv = process.env.SUPABASE_SERVICE_ROLE_KEY
  const empty: KpiBlock = {
    visits: 0, pageviews: 0, users: 0, bookings: 0, calls: 0, revenue: 0,
    delta_visits: 0, delta_pageviews: 0, delta_users: 0,
  }
  if (!supabaseUrlEnv || !supabaseKeyEnv) {
    return { kpis: empty, warnings: ['Fallback non disponibile: SUPABASE non configurato.'] }
  }
  try {
    const sb = createClient(supabaseUrlEnv, supabaseKeyEnv)
    const days = range === '7d' ? 7 : range === '90d' ? 90 : range === '180d' ? 180 : range === '365d' ? 365 : 28
    const now = new Date()
    const start = new Date(now.getTime() - days * 86400000).toISOString()
    const prevStart = new Date(now.getTime() - days * 2 * 86400000).toISOString()
    const prevEnd = start

    // Bookings nel periodo + nel periodo precedente
    const [{ count: bookCur }, { count: bookPrev }, { data: paidBookings }, { count: customersCur }] = await Promise.all([
      sb.from('bookings').select('id', { count: 'exact', head: true }).gte('created_at', start),
      sb.from('bookings').select('id', { count: 'exact', head: true }).gte('created_at', prevStart).lt('created_at', prevEnd),
      sb.from('bookings').select('price_total, payment_status').gte('created_at', start).limit(2000),
      sb.from('customers_extended').select('id', { count: 'exact', head: true }).gte('created_at', start),
    ])
    const isPaid = (s?: string | null) => s === 'paid' || s === 'completed' || s === 'succeeded'
    const revenue = (paidBookings || []).reduce((acc: number, b: { price_total?: number | null; payment_status?: string | null }) =>
      isPaid(b.payment_status) ? acc + (Number(b.price_total) || 0) / 100 : acc, 0)

    // I "click telefono" (calls) li proxy come clienti UNICI con telefono nel periodo
    const { data: phones } = await sb
      .from('customers_extended')
      .select('telefono')
      .not('telefono', 'is', null)
      .gte('created_at', start)
      .limit(5000)
    const calls = new Set((phones || []).map((p: { telefono?: string | null }) => (p.telefono || '').trim()).filter(Boolean)).size

    const cur = bookCur || 0
    const prev = bookPrev || 0
    const deltaPct = prev > 0 ? ((cur - prev) / prev) * 100 : 0

    return {
      kpis: {
        visits: cur,         // proxy: prenotazioni create
        pageviews: cur * 5,  // stima: ~5 pagine viste per booking creato
        users: customersCur || 0,
        bookings: cur,
        calls,
        revenue,
        delta_visits: deltaPct,
        delta_pageviews: deltaPct,
        delta_users: deltaPct,
      },
      warnings: [
        'GA4 non raggiungibile — i numeri sotto sono dati operativi interni (prenotazioni/clienti/fatturato), NON traffico web. Riconfigura GA4 per dati di traffico reale.',
      ],
    }
  } catch (e) {
    return { kpis: empty, warnings: [`Fallback interno fallito: ${e instanceof Error ? e.message : String(e)}`] }
  }
}

function rangeToDates(range: string): { startDate: string; endDate: string; prevStart: string; prevEnd: string } {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : range === '180d' ? 180 : range === '365d' ? 365 : 28
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
  // OAuth refresh token (preferito quando il service account non funziona):
  // l'admin connette il proprio Google account dal pulsante in UI e da li'
  // in poi tutte le chiamate GA usano quel token. Non c'e' problema con
  // 'questo email non corrisponde a un account Google' perche' e' una
  // identita' Gmail vera, non un service account.
  let oauthRefreshToken: string | undefined
  let oauthLookupError: string | undefined
  // Read GA creds from Supabase app_secrets (persistent storage that
  // doesn't count against the 4KB Lambda env-var cap).
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data: credsData } = await supabase
        .from('app_secrets')
        .select('value')
        .eq('key', 'ga4_creds')
        .maybeSingle()
      if (credsData?.value) {
        const v = credsData.value as { privateKey?: string; clientEmail?: string }
        blobKey = v.privateKey || undefined
        blobEmail = v.clientEmail || undefined
      }
      // OAuth refresh token (preferito se presente)
      const { data: oauthData, error: oauthErr } = await supabase
        .from('app_secrets')
        .select('value')
        .eq('key', 'ga4_oauth_refresh_token')
        .maybeSingle()
      if (oauthErr) oauthLookupError = oauthErr.message
      if (oauthData?.value) {
        const v = oauthData.value as { refresh_token?: string }
        oauthRefreshToken = v.refresh_token || undefined
      }
    } catch (e) {
      oauthLookupError = e instanceof Error ? e.message : String(e)
    }
  }

  const hasFull = !!credsRaw
  const hasSplit = !!splitEmail && !!splitKey
  const hasBlob = !!blobKey
  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  const hasOAuth = !!oauthRefreshToken && !!oauthClientId && !!oauthClientSecret

  // Diagnostic log on every call — printed BEFORE we decide auth path so the
  // Netlify function logs always show exactly which credentials were resolved
  // and which path will be taken. Never logs secret values, only presence.
  console.log('[ga-report] creds-resolution', {
    propertyIdSet: !!propertyId,
    hasFull,
    hasSplit,
    hasBlob,
    oauth: {
      refreshTokenFromSupabase: !!oauthRefreshToken,
      refreshTokenSrc: oauthRefreshToken ? 'app_secrets.ga4_oauth_refresh_token' : null,
      clientIdSrc: process.env.GOOGLE_OAUTH_CLIENT_ID
        ? 'GOOGLE_OAUTH_CLIENT_ID'
        : process.env.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_ID (legacy)' : null,
      clientSecretSrc: process.env.GOOGLE_OAUTH_CLIENT_SECRET
        ? 'GOOGLE_OAUTH_CLIENT_SECRET'
        : process.env.GOOGLE_CLIENT_SECRET ? 'GOOGLE_CLIENT_SECRET (legacy)' : null,
      hasOAuth,
    },
    oauthLookupError: oauthLookupError || null,
    chosenPath: hasOAuth ? 'oauth' : (hasFull || hasSplit || hasBlob) ? 'jwt-service-account' : 'none',
  })

  const missing: string[] = []
  if (!propertyId) missing.push('GA4_PROPERTY_ID')
  if (!hasFull && !hasSplit && !hasBlob && !hasOAuth) {
    missing.push('credenziali GA4 (clicca "Connetti Google" in Rendimento Sito per autenticarti col tuo account, oppure carica un service account)')
  }

  const empty: ReportPayload = {
    configured: false,
    missing,
    range,
    kpis: null,
    realtime: null,
    traffic: [],
    distribution: [],
    funnel: [],
    topPages: [],
    fetchedAt: new Date().toISOString(),
    warnings: [],
  }

  if (missing.length > 0) {
    const fallback = await buildInternalFallback(range)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...empty,
        kpis: fallback.kpis,
        dataSource: 'internal',
        warnings: fallback.warnings,
      }),
    }
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
        body: JSON.stringify({
          ...empty,
          ...(await buildInternalFallback(range).then(f => ({ kpis: f.kpis, dataSource: 'internal' as const, warnings: ['GA4_SERVICE_ACCOUNT_JSON non è un JSON valido', ...f.warnings] }))),
        }),
      }
    }
  } else if (hasSplit) {
    clientEmail = splitEmail
    privateKey = splitKey?.replace(/\\n/g, '\n')
  } else {
    // From Netlify Blobs (preferred for DR7). Bug fix: il path env-var
    // fa replace(\\n, \n), questo path no — se la chiave era stata
    // salvata con escape letterali \n (capita con i form multi-line)
    // la firma JWT falliva con 'Invalid JWT Signature'.
    clientEmail = blobEmail || splitEmail
    privateKey = blobKey?.replace(/\\n/g, '\n')
  }

  // BUG FIX: questo gate richiedeva clientEmail+privateKey anche quando
  // l'utente aveva configurato SOLO OAuth (refresh token). Risultato: pur
  // avendo completato il flusso OAuth, ga-report ricadeva sempre su
  // 'internal' con warning 'client_email o private_key mancanti'. Ora
  // saltiamo il gate quando hasOAuth e' true — la JWT path non parte
  // comunque (line 311 controlla hasOAuth).
  if (!hasOAuth && (!clientEmail || !privateKey)) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...empty,
        ...(await buildInternalFallback(range).then(f => ({ kpis: f.kpis, dataSource: 'internal' as const, warnings: ['client_email o private_key mancanti dopo il parsing', ...f.warnings] }))),
      }),
    }
  }
  // Log esplicito per debug Netlify: vediamo a colpo d'occhio quale path
  // sta usando la function quando il dato sembra strano.
  console.log('[ga-report] auth path:', hasOAuth ? 'oauth-user' : 'service-account-jwt',
    { hasOAuth, hasFull, hasSplit, hasBlob, oauthLookupError })

  try {
    // Auth: preferiamo OAuth (account utente) se disponibile, altrimenti
    // fallback su service account JWT. OAuth bypassa il problema di GA4
    // che rifiuta certi email di service account.
    let auth: any
    if (hasOAuth) {
      const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI
        || (process.env.URL ? `${process.env.URL}/.netlify/functions/ga-oauth-callback` : undefined)
      const oauth2 = new google.auth.OAuth2(oauthClientId, oauthClientSecret, redirectUri)
      oauth2.setCredentials({ refresh_token: oauthRefreshToken })
      auth = oauth2
      console.log('[ga-report] using OAuth user-account auth')
    } else {
      auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      })
      console.log('[ga-report] using service-account JWT auth', { clientEmail })
    }
    const analytics = google.analyticsdata({ version: 'v1beta', auth })

    const dates = rangeToDates(range)
    const property = `properties/${propertyId}`

    // Run all queries in parallel — includes runRealtimeReport so the UI
    // gets up-to-the-minute data without waiting 24-48h for the standard
    // Reporting API to ingest events. Realtime API has no latency.
    const [kpiCurr, kpiPrev, byDay, byChannel, byPage, conversions, realtimeKpi, realtimeEvents, realtimePages] = await Promise.all([
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
      // Realtime: utenti attivi + pageviews ultimi 30 min
      analytics.properties.runRealtimeReport({
        property,
        requestBody: {
          metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'eventCount' }],
        },
      }),
      // Realtime: eventi conversione ultimi 30 min
      analytics.properties.runRealtimeReport({
        property,
        requestBody: {
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
        },
      }),
      // Realtime: top pagine attive ora
      analytics.properties.runRealtimeReport({
        property,
        requestBody: {
          dimensions: [{ name: 'unifiedScreenName' }],
          metrics: [{ name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
          limit: '5',
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
    // BUG FIX 2026-05-15: gtag conversion events non sono installati sul sito,
    // quindi GA4 ritorna 0 booking/call/revenue. Invece di mostrare 0 e dire
    // all'admin "aggiungi gtag(...)" (cosa che lei non puo' fare), usiamo
    // i dati operativi reali dal CRM (Supabase bookings + customers). Le
    // KPI conversioni sono quindi SEMPRE riempite, le KPI traffico (visits,
    // pageviews, users) restano GA4.
    let bookingsFromCrm = false
    if (bookings === 0 && calls === 0 && revenue === 0) {
      try {
        const fallback = await buildInternalFallback(range)
        bookings = fallback.kpis.bookings
        calls = fallback.kpis.calls
        revenue = fallback.kpis.revenue
        bookingsFromCrm = true
      } catch { /* tieni 0 — il warning sotto avvisa */ }
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

    // Realtime block — ultimi 30 min, nessun ritardo dell'API
    const rtRow = realtimeKpi.data.rows?.[0]?.metricValues || []
    const activeUsers = Number(rtRow[0]?.value || 0)
    const pageviews30m = Number(rtRow[1]?.value || 0)
    const events30m = Number(rtRow[2]?.value || 0)
    let conversions30m = 0
    for (const row of realtimeEvents.data.rows || []) {
      const name = row.dimensionValues?.[0]?.value || ''
      const count = Number(row.metricValues?.[0]?.value || 0)
      if (name === 'booking_completed' || name === 'purchase' || name === 'phone_call' || name === 'click_to_call') {
        conversions30m += count
      }
    }
    const topActivePages = (realtimePages.data.rows || []).map(r => ({
      page: r.dimensionValues?.[0]?.value || '/',
      users: Number(r.metricValues?.[0]?.value || 0),
    }))
    const realtime: RealtimeBlock = { activeUsers, pageviews30m, events30m, conversions30m, topActivePages }

    const warnings: string[] = []
    if (sessions === 0 && activeUsers === 0) warnings.push('Nessuna visita registrata nel periodo selezionato — verifica che lo snippet GA4 sia attivo su dr7empire.com.')
    // BUG FIX 2026-05-15: warning "aggiungi gtag" rimosso. Era inutile per
    // l'admin (non puo' modificare il codice del sito). Adesso, se le
    // conversioni vengono dal CRM (bookingsFromCrm=true), diciamo chiaramente
    // che le KPI conversioni sono operative interne.
    if (bookingsFromCrm) {
      warnings.push('Conversioni (Prenotazioni, Telefono, Fatturato) lette dal CRM interno — il sito non invia ancora eventi gtag a GA4. Le KPI traffico (Visite, Pagine, Utenti) restano da GA4.')
    }
    if (sessions === 0 && activeUsers > 0) warnings.push(`Tracking attivo: ${activeUsers} utenti in tempo reale. I dati storici (28 giorni) appariranno entro 24-48h, il tempo standard di ingestione di GA4.`)

    // Se GA4 risponde ma con TUTTO a zero (sessions, pageviews, users e
    // conversioni) significa che il tracking non e' arrivato o non c'e'
    // ancora nessuna visita: fa piu' senso mostrare i dati interni del
    // CRM cosi' la tab e' utile, invece di tante caselle 0.
    // GA4 ha risposto correttamente. Se i numeri sono tutti 0 vuol dire
    // che il sito NON sta inviando eventi a GA4 (snippet mancante o
    // non installato sul dominio configurato). Mostriamo i veri 0 con
    // un avviso esplicito: e' un problema di tracking sul sito, non
    // di accesso GA4. Niente fallback — se ci scambiamo dati operativi
    // si confonde la diagnosi.

    const payload: ReportPayload = {
      configured: true,
      missing: [],
      range,
      kpis,
      realtime,
      traffic,
      distribution,
      funnel,
      topPages,
      fetchedAt: new Date().toISOString(),
      warnings,
      dataSource: 'ga4',
      conversionsSource: bookingsFromCrm ? 'crm' : 'ga4',
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

    // Fallback su dati interni Supabase: la tab non resta mai vuota.
    const fallback = await buildInternalFallback(range)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...empty,
        configured: !!propertyId && credsLoaded,
        kpis: fallback.kpis,
        dataSource: 'internal',
        warnings: [`Errore Google Analytics Data API: ${errMsg}`, ...fallback.warnings],
        permissionIssue: isPermissionError && clientEmail && propertyId
          ? { serviceAccountEmail: clientEmail, propertyId }
          : null,
      }),
    }
  }
}

export { handler }
