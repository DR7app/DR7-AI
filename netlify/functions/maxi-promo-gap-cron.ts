/**
 * Maxi Promo Gap — scheduled cron.
 *
 * Runs every 10 minutes. For each vehicle with a 1-day gap TOMORROW
 * (Europe/Rome), checks the dedup table `maxi_promo_sent_log` and, if
 * never sent, sends the Pro template `pro_maxi_promo_gap_1gg` to a single
 * pilot phone defined by the env var MAXI_PROMO_PILOT_PHONE.
 *
 * Two firing conditions (OR):
 *   1. Local Rome time is at or past 18:00 (the "day-before" cron).
 *   2. The vehicle had a booking inserted in the last 20 minutes
 *      (post-booking trigger — covers the case where a customer
 *      books a slot that creates the 1-day gap).
 *
 * The recipient phone, the body of the message, and the template key
 * resolution all live OUTSIDE this code:
 *   - Phone   → env var MAXI_PROMO_PILOT_PHONE
 *   - Body    → Messaggi di Sistema Pro row "MAXI PROMO GAP 1GG"
 *   - Mapping → utils/messageTemplates.ts (LABEL_FALLBACKS)
 *
 * Nothing is hardcoded.
 */
import { schedule } from '@netlify/functions'
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

interface Vehicle {
  id: string
  display_name: string
  plate: string | null
  status: string | null
  category: string | null
}

interface Booking {
  id: string
  vehicle_id: string | null
  vehicle_plate: string | null
  pickup_date: string
  dropoff_date: string
  status: string | null
  service_type: string | null
  created_at: string
}

function normalisePhone(raw: string): string | null {
  let clean = (raw || '').replace(/[^\d]/g, '')
  if (!clean) return null
  if (clean.startsWith('00')) clean = clean.slice(2)
  if (clean.startsWith('0')) clean = '39' + clean.slice(1)
  if (!clean.startsWith('39') && clean.length === 10) clean = '39' + clean
  if (clean.length < 11) return null
  return clean
}

function romeMidnightOffset(daysFromToday: number): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const today = new Date()
  const romeYMD = fmt.format(today)
  const [y, m, d] = romeYMD.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d + daysFromToday, 0, 0, 0))
  const partsFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', timeZoneName: 'shortOffset', hour12: false,
  })
  const tzPart = partsFmt.formatToParts(utc).find(p => p.type === 'timeZoneName')?.value || 'GMT+1'
  const m2 = /GMT([+-]\d+)/.exec(tzPart)
  const offsetH = m2 ? parseInt(m2[1], 10) : 1
  return new Date(utc.getTime() - offsetH * 3600 * 1000)
}

function romeHour(): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hour: '2-digit', hour12: false,
  })
  return parseInt(fmt.format(new Date()), 10)
}

function romeYMD(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

const cronHandler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
  const skip = (reason: string) => {
    console.log('[maxi-promo-cron] skip:', reason)
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason }) }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return skip('missing supabase env')
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) return skip('missing green api env')

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Read the runtime setting from DB (no env vars). Mode = off | pilot | broadcast.
  const { data: settings } = await supabase
    .from('maxi_promo_settings')
    .select('mode, pilot_phone')
    .eq('id', 1)
    .maybeSingle()

  const mode = (settings?.mode || 'off') as 'off' | 'pilot' | 'broadcast'
  if (mode === 'off') return skip('mode=off')

  // Build the recipient list.
  // - pilot     → 1 number from settings.pilot_phone
  // - broadcast → every customers_extended row with telefono not null/blacklist
  let recipients: string[] = []
  if (mode === 'pilot') {
    const r = normalisePhone(settings?.pilot_phone || '')
    if (!r) return skip('mode=pilot but pilot_phone empty/invalid')
    recipients = [r]
  } else {
    const { data: custRows } = await supabase
      .from('customers_extended')
      .select('telefono, status_cliente')
      .not('telefono', 'is', null)
    const seen = new Set<string>()
    for (const row of (custRows || [])) {
      if (row.status_cliente === 'blacklist') continue
      const n = normalisePhone(row.telefono || '')
      if (n && !seen.has(n)) { seen.add(n); recipients.push(n) }
    }
    if (recipients.length === 0) return skip('mode=broadcast but no customers with phone')
  }

  const tomorrowStart = romeMidnightOffset(1)
  const tomorrowEnd   = romeMidnightOffset(2)
  const dayAfterEnd   = romeMidnightOffset(3)

  const { data: vehiclesData } = await supabase
    .from('vehicles')
    .select('id, display_name, plate, status, category')
    .neq('status', 'retired')
  const vehicles: Vehicle[] = (vehiclesData || []).filter(v => v.display_name !== 'Test')

  const windowStart = tomorrowStart.toISOString()
  const windowEnd   = dayAfterEnd.toISOString()
  const { data: bookingsData } = await supabase
    .from('bookings')
    .select('id, vehicle_id, vehicle_plate, pickup_date, dropoff_date, status, service_type, created_at')
    .not('status', 'in', '(cancelled,annullata)')
    .or('service_type.is.null,service_type.eq.car_rental,service_type.eq.rental')
    .lt('pickup_date', windowEnd)
    .gt('dropoff_date', windowStart)
  const bookings: Booking[] = bookingsData || []

  const tStart = tomorrowStart.getTime()
  const tEnd   = tomorrowEnd.getTime()
  const dStart = tomorrowEnd.getTime()
  const dEnd   = dayAfterEnd.getTime()
  const RECENT_WINDOW_MS = 20 * 60 * 1000 // 20 minutes
  const recentSince = Date.now() - RECENT_WINDOW_MS
  const hour = romeHour()
  const eveningTriggerActive = hour >= 18

  // Format gap date (tomorrow) in Italian.
  const gapDateShort  = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }).format(tomorrowStart)
  const gapDateLong   = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(tomorrowStart)
  const gapDateMedium = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long' }).format(tomorrowStart)
  const gapDateDb = romeYMD(tomorrowStart) // YYYY-MM-DD for the dedup table

  const overlaps = (b: Booking, s: number, e: number) => {
    const start = new Date(b.pickup_date).getTime()
    const end   = new Date(b.dropoff_date).getTime()
    return start < e && end > s
  }

  const candidates: Array<{ vehicle: Vehicle; reason: 'evening' | 'recent_booking' }> = []
  for (const v of vehicles) {
    const vBookings = bookings.filter(b => (b.vehicle_id && b.vehicle_id === v.id)
      || (b.vehicle_plate && v.plate && b.vehicle_plate === v.plate))

    const tomorrowBooked = vBookings.some(b => overlaps(b, tStart, tEnd))
    if (tomorrowBooked) continue

    const dayAfterBooked = vBookings.some(b => overlaps(b, dStart, dEnd))
    if (!dayAfterBooked) continue

    // Decide whether THIS run should fire for this vehicle.
    const hasRecentBooking = vBookings.some(b => new Date(b.created_at).getTime() >= recentSince)
    if (!eveningTriggerActive && !hasRecentBooking) continue

    candidates.push({ vehicle: v, reason: hasRecentBooking ? 'recent_booking' : 'evening' })
  }

  if (candidates.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, gaps: 0, sent: 0, hour, eveningTriggerActive }) }
  }

  // Pull existing dedup rows for these vehicles + this gap_date (any recipient).
  const candidateIds = candidates.map(c => c.vehicle.id)
  const { data: sentRows } = await supabase
    .from('maxi_promo_sent_log')
    .select('vehicle_id, gap_date, recipient')
    .in('vehicle_id', candidateIds)
    .eq('gap_date', gapDateDb)
  const sentSet = new Set((sentRows || []).map(r => `${r.vehicle_id}|${r.gap_date}|${r.recipient}`))

  const siteUrl = process.env.URL || process.env.DEPLOY_URL || ''

  let sent = 0
  let skipped = 0
  let failed = 0
  const results: Array<{ vehicle: string; recipient: string; reason: string; ok: boolean; detail?: string }> = []

  for (const c of candidates) {
    const v = c.vehicle
    const templateVars = {
      vehicle_specs: v.display_name,
      vehicle: v.display_name,
      veicolo: v.display_name,
      date_gap: gapDateShort,
      data_gap: gapDateShort,
      gap_date: gapDateShort,
      date_gap_long: gapDateLong,
      data_gap_long: gapDateLong,
      date_gap_short: gapDateMedium,
      data: gapDateShort,
    }

    for (const phone of recipients) {
      const dedupKey = `${v.id}|${gapDateDb}|${phone}`
      if (sentSet.has(dedupKey)) {
        skipped++
        results.push({ vehicle: v.display_name, recipient: phone, reason: c.reason, ok: false, detail: 'already_sent' })
        continue
      }
      try {
        const res = await fetch(`${siteUrl}/.netlify/functions/send-whatsapp-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateKey: 'pro_maxi_promo_gap_1gg',
            templateVars,
            customPhone: phone,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          failed++
          results.push({ vehicle: v.display_name, recipient: phone, reason: c.reason, ok: false, detail: json.message || `HTTP ${res.status}` })
          continue
        }
        if (json.skipped) {
          failed++
          results.push({ vehicle: v.display_name, recipient: phone, reason: c.reason, ok: false, detail: json.reason || 'template skipped' })
          continue
        }
        await supabase.from('maxi_promo_sent_log').insert({
          vehicle_id: v.id,
          gap_date: gapDateDb,
          recipient: phone,
          template_key: 'pro_maxi_promo_gap_1gg',
        })
        sent++
        results.push({ vehicle: v.display_name, recipient: phone, reason: c.reason, ok: true })
      } catch (err) {
        failed++
        results.push({ vehicle: v.display_name, recipient: phone, reason: c.reason, ok: false, detail: err instanceof Error ? err.message : String(err) })
      }
      await new Promise(r => setTimeout(r, 800))
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      mode,
      recipients: recipients.length,
      hour,
      eveningTriggerActive,
      candidates: candidates.length,
      sent, skipped, failed,
      results,
    }),
  }
}

// Scheduled every 10 minutes (UTC). The function itself decides which gaps
// to fire on based on Rome local hour + recent-booking window, so we don't
// need a Rome-local schedule.
export const handler = schedule('*/10 * * * *', cronHandler)
