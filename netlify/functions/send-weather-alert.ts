import type { Handler } from '@netlify/functions'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Testo di DEFAULT usato SOLO per seedare il template la prima volta. Dopo il
// seed, il body diventa editabile da Messaggi di Sistema Pro e quello vince.
const DEFAULT_BODY_TERRA = `Gentile Cliente,

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

// Mare: barche — vento e pioggia. Messaggio dedicato alla sicurezza in acqua.
const DEFAULT_BODY_MARE = `Gentile Cliente,

sono previste condizioni meteo avverse in mare (*pioggia e/o vento forte*). Per la tua sicurezza e per la tutela dell'imbarcazione ti chiediamo la massima prudenza.

*Precauzioni in mare*
- Verifica sempre il bollettino meteo prima di uscire
- Evita l'uscita in caso di vento forte o mare mosso
- Indossa sempre il giubbotto di salvataggio
- Rientra in porto se le condizioni peggiorano

*Protezione dell'imbarcazione*
- Ormeggia in sicurezza e controlla le cime
- Riponi in sicurezza attrezzatura ed effetti personali

La tua sicurezza viene sempre al primo posto. In caso di dubbi contattaci prima di prendere il mare.

Cordiali saluti
DR7`

type Channel = 'terra' | 'mare'

interface ChannelConfig {
  templateKey: string
  label: string
  defaultBody: string
  /** true se il service_type della prenotazione appartiene a questo canale. */
  matches: (svc: string) => boolean
}

const CHANNELS: Record<Channel, ChannelConfig> = {
  // Terra = noleggio auto: rental / car_rental / *_rental (ESCLUSI mare/aria) o vuoto.
  terra: {
    templateKey: 'pro_allerta_meteo',
    label: 'Allerta Meteo',
    defaultBody: DEFAULT_BODY_TERRA,
    matches: (svc) => {
      if (!svc) return true // noleggi legacy con service_type nullo/vuoto = auto
      if (['car_wash', 'mechanical', 'mechanical_service', 'boat_rental', 'heli_rental', 'stay_rental'].includes(svc)) return false
      return svc === 'rental' || svc === 'car_rental' || svc.endsWith('_rental')
    },
  },
  // Mare = solo noleggio barche.
  mare: {
    templateKey: 'pro_allerta_meteo_mare',
    label: 'Allerta Meteo Mare',
    defaultBody: DEFAULT_BODY_MARE,
    matches: (svc) => svc === 'boat_rental',
  },
}

// Phone normalization — stessa logica di send-whatsapp-notification.ts.
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

interface Recipient { name: string; vehicle: string; phone: string }

/**
 * Assicura che ESISTANO le righe template di entrambi i canali in system_messages,
 * così i toggle "Cron ON/OFF" compaiono in Messaggi di Sistema Pro anche prima
 * del primo invio. Idempotente: crea solo se mancante (cron_approved default off).
 */
export async function ensureWeatherTemplates(supabase: SupabaseClient): Promise<void> {
  for (const ch of Object.keys(CHANNELS) as Channel[]) {
    const cfg = CHANNELS[ch]
    try {
      const { data } = await supabase.from('system_messages').select('id').eq('message_key', cfg.templateKey).limit(1)
      if (!data || data.length === 0) {
        await supabase.from('system_messages').insert({
          message_key: cfg.templateKey,
          label: cfg.label,
          is_enabled: true,
          message_body: cfg.defaultBody,
        })
      }
    } catch (e) {
      console.error('[send-weather-alert] ensureWeatherTemplates failed for', cfg.templateKey, e)
    }
  }
}

/**
 * Core riutilizzabile: trova i noleggi ATTUALMENTE FUORI del canale indicato e
 * (se non preview) invia il template Allerta Meteo via Green API. Usato sia dal
 * handler manuale (con auth) sia dal cron meteo automatico.
 */
export async function runWeatherAlert(
  supabase: SupabaseClient,
  opts: { channel?: Channel; preview?: boolean; testOnly?: boolean } = {},
): Promise<{ recipients: Recipient[]; sent: number; failed: number; count: number }> {
  const channel: Channel = opts.channel === 'mare' ? 'mare' : 'terra'
  const cfg = CHANNELS[channel]
  const preview = opts.preview === true
  const testOnly = opts.testOnly === true

  const nowIso = new Date().toISOString()

  // Noleggi ATTUALMENTE FUORI: NOW dentro la finestra + status attivo.
  const { data: rows, error: qErr } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_phone, vehicle_name, vehicle_plate, pickup_date, dropoff_date, status, service_type, booking_details')
    .not('status', 'in', '(cancelled,annullata,completed,completata)')
    .lte('pickup_date', nowIso)
    .gte('dropoff_date', nowIso)

  if (qErr) throw new Error(qErr.message)

  const seenPhones = new Set<string>()
  const recipients: Recipient[] = []

  for (const r of rows || []) {
    const svc = String((r as { service_type?: string }).service_type || '').toLowerCase()
    if (!cfg.matches(svc)) continue

    const plate = String((r as { vehicle_plate?: string }).vehicle_plate || '')
    if (testOnly && !/test/i.test(plate)) continue

    const bd = (r as { booking_details?: Record<string, unknown> }).booking_details || {}
    const custObj = (bd.customer || {}) as Record<string, unknown>
    const rawPhone = (r as { customer_phone?: string }).customer_phone || (custObj.phone as string) || ''
    const phone = normalizePhone(rawPhone)
    if (!phone) continue
    if (seenPhones.has(phone)) continue
    seenPhones.add(phone)

    const name = (r as { customer_name?: string }).customer_name || (custObj.fullName as string) || 'Cliente'
    const vehicle = (r as { vehicle_name?: string }).vehicle_name || (r as { vehicle_plate?: string }).vehicle_plate || ''
    recipients.push({ name, vehicle, phone })
  }

  if (preview) return { recipients, sent: 0, failed: 0, count: recipients.length }

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    throw new Error('Green API not configured')
  }

  // Body del messaggio da Messaggi di Sistema Pro (chiave del canale), con seed.
  let messageBody = ''
  const { data: tplRows } = await supabase
    .from('system_messages')
    .select('id, message_body, is_enabled, updated_at')
    .eq('message_key', cfg.templateKey)

  const usable = (tplRows || [])
    .filter((t: { is_enabled?: boolean; message_body?: string }) => t.is_enabled !== false && !!(t.message_body && t.message_body.trim()))
    .sort((a: { updated_at?: string }, b: { updated_at?: string }) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

  if (usable.length > 0) {
    messageBody = usable[0].message_body as string
  } else if (!tplRows || tplRows.length === 0) {
    try {
      await supabase.from('system_messages').insert({
        message_key: cfg.templateKey,
        label: cfg.label,
        is_enabled: true,
        message_body: cfg.defaultBody,
      })
    } catch (e) {
      console.error('[send-weather-alert] seed template failed (non-fatal):', e)
    }
    messageBody = cfg.defaultBody
  } else {
    messageBody = cfg.defaultBody
  }
  if (!messageBody || !messageBody.trim()) messageBody = cfg.defaultBody

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
      if (!resp.ok || result.error) { console.error('[send-weather-alert] Green API error for', rcpt.phone, result); failed++; continue }
      sent++
      try {
        Promise.resolve(
          supabase.from('sent_messages_log').insert({
            customer_name: rcpt.name,
            customer_phone: rcpt.phone,
            message_text: messageBody,
            template_label: cfg.label,
            status: 'sent',
          })
        ).catch((e: unknown) => console.error('[send-weather-alert] log failed:', e))
      } catch { /* non-blocking */ }
    } catch (e) {
      console.error('[send-weather-alert] send failed for', rcpt.phone, e)
      failed++
    }
  }

  return { recipients, sent, failed, count: recipients.length }
}

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const { error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase config' }) }
  }

  const body = JSON.parse(event.body || '{}')
  const channel: Channel = body?.channel === 'mare' ? 'mare' : 'terra'
  const preview: boolean = body?.preview === true
  const testOnly: boolean = body?.testOnly === true

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const result = await runWeatherAlert(supabase, { channel, preview, testOnly })
    if (preview) return { statusCode: 200, headers, body: JSON.stringify({ recipients: result.recipients, count: result.count }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: result.sent, failed: result.failed, recipients: result.recipients }) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
  }
}

export { handler }
