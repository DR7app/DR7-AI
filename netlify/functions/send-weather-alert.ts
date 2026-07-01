import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Testo di DEFAULT usato SOLO per seedare il template la prima volta.
// Dopo il seed, il body diventa editabile da Messaggi di Sistema Pro
// (chiave `pro_allerta_meteo`) e quello vince sempre.
const DEFAULT_BODY = `Gentile Cliente,

in presenza di condizioni meteo avverse (come pioggia intensa, grandine o vento forte), è fondamentale prestare particolare attenzione per *tutelare la tua sicurezza personale e proteggere il veicolo in tuo utilizzo*.

Ti invitiamo a seguire alcune semplici precauzioni:

*Durante la guida*
- Riduci la velocità e aumenta la distanza di sicurezza
- Evita percorsi soggetti ad allagamenti
- Non attraversare sottopassi o zone con acqua alta

*Protezione del veicolo*
- Se possibile, parcheggia in *garage o aree coperte*
- Evita soste sotto alberi, impalcature o strutture instabili
- In caso di grandine, utilizza sistemi di protezione (teli o coperture)

La tua sicurezza personale viene sempre al primo posto: adotta comportamenti prudenti per proteggere te stesso e prevenire danni al veicolo.

Cordiali saluti
DR7`

// Phone normalization — stessa identica logica di send-whatsapp-notification.ts
// (Green API format: 393457905205, no + / spazi / caratteri invisibili).
function normalizePhone(raw: string): string | null {
  let phone = String(raw || '').replace(/\D/g, '')
  if (!phone) return null
  if (phone.startsWith('00')) phone = phone.substring(2)
  if (/^3\d{8,9}$/.test(phone)) {
    phone = '39' + phone
  } else if (phone.length === 10) {
    phone = '39' + phone
  }
  return phone || null
}

interface Recipient {
  name: string
  vehicle: string
  phone: string
}

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const { error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase config' }) }
  }

  const body = JSON.parse(event.body || '{}')
  const preview: boolean = body?.preview === true

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const nowIso = new Date().toISOString()

  // Noleggi auto ATTUALMENTE FUORI: NOW è dentro la finestra di noleggio.
  //  - status attivo (escludiamo cancelled/annullata/completed/completata)
  //  - pickup_date <= now AND dropoff_date >= now
  // Il filtro service_type (rental / null / non-lavaggio-meccanica) lo
  // applichiamo lato codice così includiamo anche le righe con
  // service_type NULL o stringa vuota (noleggi legacy).
  const { data: rows, error: qErr } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_phone, vehicle_name, vehicle_plate, pickup_date, dropoff_date, status, service_type, booking_details')
    .not('status', 'in', '(cancelled,annullata,completed,completata)')
    .lte('pickup_date', nowIso)
    .gte('dropoff_date', nowIso)

  if (qErr) {
    console.error('[send-weather-alert] query error:', qErr)
    return { statusCode: 500, headers, body: JSON.stringify({ error: qErr.message }) }
  }

  const NON_RENTAL = new Set(['car_wash', 'mechanical', 'mechanical_service'])
  const seenPhones = new Set<string>()
  const recipients: Recipient[] = []

  for (const r of rows || []) {
    const svc = String((r as { service_type?: string }).service_type || '').toLowerCase()
    // Solo noleggi: rental / car_rental / *_rental / vuoto. Salta lavaggio/meccanica.
    if (svc && NON_RENTAL.has(svc)) continue

    const bd = (r as { booking_details?: Record<string, unknown> }).booking_details || {}
    const custObj = (bd.customer || {}) as Record<string, unknown>
    const rawPhone =
      (r as { customer_phone?: string }).customer_phone ||
      (custObj.phone as string) ||
      ''
    const phone = normalizePhone(rawPhone)
    if (!phone) continue
    if (seenPhones.has(phone)) continue
    seenPhones.add(phone)

    const name =
      (r as { customer_name?: string }).customer_name ||
      (custObj.fullName as string) ||
      'Cliente'
    const vehicle =
      (r as { vehicle_name?: string }).vehicle_name ||
      (r as { vehicle_plate?: string }).vehicle_plate ||
      ''

    recipients.push({ name, vehicle, phone })
  }

  if (preview) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ recipients, count: recipients.length }),
    }
  }

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('[send-weather-alert] Green API not configured.')
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Green API not configured' }) }
  }

  // ── Risolvi il body del messaggio da Messaggi di Sistema Pro ──
  // Leggi TUTTE le righe per la chiave (evita il trap del .maybeSingle()
  // quando esistono duplicati) e scegli la enabled + non vuota aggiornata
  // più di recente. Se la riga non esiste, la creiamo col DEFAULT_BODY
  // così diventa editabile da subito.
  let messageBody = ''
  const { data: tplRows } = await supabase
    .from('system_messages')
    .select('id, message_body, is_enabled, updated_at')
    .eq('message_key', 'pro_allerta_meteo')

  const usable = (tplRows || [])
    .filter((t: { is_enabled?: boolean; message_body?: string }) =>
      t.is_enabled !== false && !!(t.message_body && t.message_body.trim()))
    .sort((a: { updated_at?: string }, b: { updated_at?: string }) =>
      String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

  if (usable.length > 0) {
    messageBody = usable[0].message_body as string
  } else if (!tplRows || tplRows.length === 0) {
    // Nessuna riga → seed del template così l'admin può modificarlo dopo.
    try {
      await supabase.from('system_messages').insert({
        message_key: 'pro_allerta_meteo',
        label: 'Allerta Meteo',
        is_enabled: true,
        message_body: DEFAULT_BODY,
      })
    } catch (e) {
      console.error('[send-weather-alert] seed template failed (non-fatal):', e)
    }
    messageBody = DEFAULT_BODY
  } else {
    // Righe esistono ma disabilitate / vuote → usa il default per questo invio.
    messageBody = DEFAULT_BODY
  }

  if (!messageBody || !messageBody.trim()) messageBody = DEFAULT_BODY

  const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`

  let sent = 0
  let failed = 0
  for (const rcpt of recipients) {
    try {
      const resp = await fetch(greenApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${rcpt.phone}@c.us`, message: messageBody }),
      })
      const result = await resp.json()
      if (!resp.ok || result.error) {
        console.error('[send-weather-alert] Green API error for', rcpt.phone, result)
        failed++
        continue
      }
      sent++

      // Log — fire and forget, mai bloccante (stessa shape di send-whatsapp-notification).
      try {
        Promise.resolve(
          supabase.from('sent_messages_log').insert({
            customer_name: rcpt.name,
            customer_phone: rcpt.phone,
            message_text: messageBody,
            template_label: 'Allerta Meteo',
            status: 'sent',
          })
        ).catch((e: unknown) => console.error('[send-weather-alert] log failed:', e))
      } catch { /* non-blocking */ }
    } catch (e) {
      console.error('[send-weather-alert] send failed for', rcpt.phone, e)
      failed++
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, sent, failed, recipients }),
  }
}

export { handler }
