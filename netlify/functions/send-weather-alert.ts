import type { Handler } from '@netlify/functions'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'
import { loadMeteoConfig, toMeteoBusiness, TEMPLATE_TERRA, TEMPLATE_MARE, type MeteoBusiness } from './weather-config'

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

// 31/08/2026 — un canale per BUSINESS, non piu' solo Terra e Mare.
// Chi riceve e con quale testo lo dice `weather-config.ts` (sezione Allerta
// Meteo della Centralina, una configurazione per business).
export type Channel = MeteoBusiness

interface ChannelConfig {
  label: string
  /** Template Pro proposto quando la Centralina non ne ha scelto un altro. */
  templateKey: string
  /** true se il service_type della prenotazione appartiene a questo business. */
  matches: (svc: string) => boolean
  /**
   * Chi e' "esposto" al maltempo per questo business:
   *  - 'in_corso'  = il cliente ha il mezzo adesso (noleggi e soggiorni);
   *  - 'in_arrivo' = ha un appuntamento nelle prossime ore (lavaggio: durante
   *    il lavaggio il cliente non c'e', l'avviso serve PRIMA che si presenti).
   */
  finestra: 'in_corso' | 'in_arrivo'
}

const CHANNELS: Record<Channel, ChannelConfig> = {
  // Terra = noleggio auto: rental / car_rental / *_rental (ESCLUSI mare/aria) o vuoto.
  terra: {
    label: 'Allerta Meteo',
    templateKey: TEMPLATE_TERRA,
    finestra: 'in_corso',
    matches: (svc) => {
      if (!svc) return true // noleggi legacy con service_type nullo/vuoto = auto
      if (['car_wash', 'mechanical', 'mechanical_service', 'boat_rental', 'heli_rental', 'stay_rental'].includes(svc)) return false
      return svc === 'rental' || svc === 'car_rental' || svc.endsWith('_rental')
    },
  },
  // Mare = solo noleggio barche.
  mare: {
    label: 'Allerta Meteo Mare',
    templateKey: TEMPLATE_MARE,
    finestra: 'in_corso',
    matches: (svc) => svc === 'boat_rental',
  },
  aria: {
    label: 'Allerta Meteo Aria',
    templateKey: TEMPLATE_TERRA,
    finestra: 'in_corso',
    matches: (svc) => svc === 'heli_rental',
  },
  soggiorni: {
    label: 'Allerta Meteo Soggiorni',
    templateKey: TEMPLATE_TERRA,
    finestra: 'in_corso',
    matches: (svc) => svc === 'stay_rental',
  },
  lavaggio: {
    label: 'Allerta Meteo Lavaggio',
    templateKey: TEMPLATE_TERRA,
    finestra: 'in_arrivo',
    matches: (svc) => svc === 'car_wash' || svc === 'mechanical' || svc === 'mechanical_service',
  },
}

/** Testo di fabbrica dei DUE template che esistono davvero in system_messages. */
const DEFAULT_BODIES: Record<string, string> = {
  [TEMPLATE_TERRA]: DEFAULT_BODY_TERRA,
  [TEMPLATE_MARE]: DEFAULT_BODY_MARE,
}
const TEMPLATE_LABELS: Record<string, string> = {
  [TEMPLATE_TERRA]: 'Allerta Meteo',
  [TEMPLATE_MARE]: 'Allerta Meteo Mare',
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
 * Assicura che ESISTANO in system_messages le righe dei template meteo, cosi'
 * i toggle compaiono in Messaggi di Sistema Pro anche prima del primo invio.
 * Idempotente: crea solo cio' che manca (cron_approved resta spento).
 *
 * I template restano DUE (Terra e Mare): i business nuovi scelgono quale
 * spedire dalla sezione Allerta Meteo, non aggiungono voci al catalogo Pro.
 */
export async function ensureWeatherTemplates(supabase: SupabaseClient): Promise<void> {
  for (const key of Object.keys(DEFAULT_BODIES)) {
    try {
      const { data } = await supabase.from('system_messages').select('id').eq('message_key', key).limit(1)
      if (!data || data.length === 0) {
        await supabase.from('system_messages').insert({
          message_key: key,
          label: TEMPLATE_LABELS[key] || 'Allerta Meteo',
          is_enabled: true,
          message_body: DEFAULT_BODIES[key],
        })
      }
    } catch (e) {
      console.error('[send-weather-alert] ensureWeatherTemplates failed for', key, e)
    }
  }
}

/**
 * Core riutilizzabile: trova i clienti ESPOSTI al maltempo per il business
 * indicato e (se non preview) invia il template Allerta Meteo via Green API.
 * Usato sia dal handler manuale (con auth) sia dal cron meteo automatico.
 *
 * `templateKey` e `oreAvanti` arrivano dal cron, che ha gia' letto la config
 * del business: senza, li si rilegge qui.
 */
export async function runWeatherAlert(
  supabase: SupabaseClient,
  opts: {
    channel?: string
    business?: string
    preview?: boolean
    testOnly?: boolean
    templateKey?: string
    oreAvanti?: number
  } = {},
): Promise<{ recipients: Recipient[]; sent: number; failed: number; count: number; templateKey: string; business: Channel }> {
  const business = toMeteoBusiness(opts.business ?? opts.channel ?? 'terra')
  const cfg = CHANNELS[business]
  const preview = opts.preview === true
  const testOnly = opts.testOnly === true

  let templateKey = opts.templateKey
  let oreAvanti = opts.oreAvanti
  if (!templateKey || !oreAvanti) {
    const meteo = await loadMeteoConfig(supabase, business)
    templateKey = templateKey || meteo.template_key
    oreAvanti = oreAvanti || meteo.ore_avanti
  }

  const now = new Date()
  const nowIso = now.toISOString()

  // Chi e' esposto: col mezzo in mano adesso, oppure atteso nelle prossime ore
  // (lavaggio). L'ora di scarto all'indietro copre chi e' appena arrivato.
  let query = supabase
    .from('bookings')
    .select('id, customer_name, customer_phone, vehicle_name, vehicle_plate, pickup_date, dropoff_date, status, service_type, booking_details')
    .not('status', 'in', '(cancelled,annullata,completed,completata)')
  if (cfg.finestra === 'in_arrivo') {
    const da = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const a = new Date(now.getTime() + oreAvanti * 60 * 60 * 1000).toISOString()
    query = query.gte('pickup_date', da).lte('pickup_date', a)
  } else {
    query = query.lte('pickup_date', nowIso).gte('dropoff_date', nowIso)
  }
  const { data: rows, error: qErr } = await query

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

  if (preview) return { recipients, sent: 0, failed: 0, count: recipients.length, templateKey, business }

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    throw new Error('Green API not configured')
  }

  // Body del messaggio da Messaggi di Sistema Pro (chiave scelta in Centralina),
  // con seed dei soli template di fabbrica.
  const fallbackBody = DEFAULT_BODIES[templateKey] || DEFAULT_BODY_TERRA
  let messageBody = ''
  const { data: tplRows } = await supabase
    .from('system_messages')
    .select('id, message_body, is_enabled, updated_at')
    .eq('message_key', templateKey)

  const usable = (tplRows || [])
    .filter((t: { is_enabled?: boolean; message_body?: string }) => t.is_enabled !== false && !!(t.message_body && t.message_body.trim()))
    .sort((a: { updated_at?: string }, b: { updated_at?: string }) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

  if (usable.length > 0) {
    messageBody = usable[0].message_body as string
  } else if (!tplRows || tplRows.length === 0) {
    try {
      await supabase.from('system_messages').insert({
        message_key: templateKey,
        label: TEMPLATE_LABELS[templateKey] || cfg.label,
        is_enabled: true,
        message_body: fallbackBody,
      })
    } catch (e) {
      console.error('[send-weather-alert] seed template failed (non-fatal):', e)
    }
    messageBody = fallbackBody
  } else {
    messageBody = fallbackBody
  }
  if (!messageBody || !messageBody.trim()) messageBody = fallbackBody

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

  return { recipients, sent, failed, count: recipients.length, templateKey, business }
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
  // `business` e' il parametro nuovo (terra|mare|aria|soggiorni|lavaggio);
  // `channel` resta accettato per le pagine ancora aperte con il codice vecchio.
  const business: Channel = toMeteoBusiness(body?.business ?? body?.channel ?? 'terra')
  const preview: boolean = body?.preview === true
  const testOnly: boolean = body?.testOnly === true

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const result = await runWeatherAlert(supabase, { business, preview, testOnly })
    if (preview) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ recipients: result.recipients, count: result.count, business: result.business, templateKey: result.templateKey }),
      }
    }
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, sent: result.sent, failed: result.failed, recipients: result.recipients, business: result.business }),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
  }
}

export { handler }
