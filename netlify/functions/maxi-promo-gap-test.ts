/**
 * Maxi Promo Gap — TEST endpoint.
 *
 * Detects vehicles that have a 1-day gap tomorrow (tomorrow is free AND the
 * day after has a booking) and sends the Pro template
 * `pro_maxi_promo_gap_1gg` to a single TEST phone number — one WhatsApp per
 * gap vehicle, with `{vehicle_specs}` filled in.
 *
 * No broadcast, no cron. Designed to validate the message + variable wiring
 * before turning the broadcast on.
 *
 * POST /.netlify/functions/maxi-promo-gap-test
 * Body:
 *   { phone: string,           // recipient (any format; will be normalised)
 *     dryRun?: boolean }       // if true, don't send — just return the list
 */
import type { Handler } from '@netlify/functions'
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

// Get tomorrow midnight in Europe/Rome → returned as Date in UTC.
function romeMidnightOffset(daysFromToday: number): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const today = new Date()
  const romeYMD = fmt.format(today) // "YYYY-MM-DD"
  const [y, m, d] = romeYMD.split('-').map(Number)
  // Build a UTC midnight then offset by Rome offset (handles DST coarsely).
  const utc = new Date(Date.UTC(y, m - 1, d + daysFromToday, 0, 0, 0))
  // Compute Rome offset for that UTC instant
  const partsFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', timeZoneName: 'shortOffset', hour12: false,
  })
  const tzPart = partsFmt.formatToParts(utc).find(p => p.type === 'timeZoneName')?.value || 'GMT+1'
  const m2 = /GMT([+-]\d+)/.exec(tzPart)
  const offsetH = m2 ? parseInt(m2[1], 10) : 1
  // Rome midnight in UTC = UTC midnight − offset hours
  return new Date(utc.getTime() - offsetH * 3600 * 1000)
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase env not configured' }) }
  }
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Green API env not configured' }) }
  }

  const body = JSON.parse(event.body || '{}')
  const { phone, dryRun } = body as { phone?: string; dryRun?: boolean }

  if (!dryRun && !phone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'phone is required (or set dryRun: true)' }) }
  }

  const recipient = phone ? normalisePhone(phone) : null
  if (!dryRun && !recipient) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid phone number' }) }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const now = new Date()
  // Horizon: scan the next 365 days. Any gap of [4h, 48h] anywhere in the
  // coming year qualifies — the gap doesn't have to be tomorrow. Each
  // qualifying vehicle still produces a single candidate (the gap before
  // its NEXT upcoming booking) to avoid spamming about future gaps that
  // are already on the calendar but haven't materialised yet.
  const horizonEnd = new Date(now.getTime() + 365 * 24 * 3600 * 1000)

  const { data: vehiclesData } = await supabase
    .from('vehicles')
    .select('id, display_name, plate, status, category')
    .neq('status', 'retired')
  const vehicles: Vehicle[] = (vehiclesData || []).filter(v => v.display_name !== 'Test')

  // Load every upcoming rental booking starting in the next 48h, plus any
  // currently active booking (dropoff still in the future) so we can decide
  // if the vehicle is busy right now.
  const { data: bookingsData } = await supabase
    .from('bookings')
    .select('id, vehicle_id, vehicle_plate, pickup_date, dropoff_date, status, service_type')
    .not('status', 'in', '(cancelled,annullata)')
    .or('service_type.is.null,service_type.eq.car_rental,service_type.eq.rental')
    .lt('pickup_date', horizonEnd.toISOString())
    .gt('dropoff_date', now.toISOString())
  const bookings: Booking[] = bookingsData || []

  // Per-vehicle gap detection.
  // A gap exists when there is a free window of [4h, 48h] either:
  //   (a) Between now and the FIRST upcoming booking (the imminent gap), or
  //   (b) Between any two CONSECUTIVE bookings within the 365-day horizon.
  // We emit ONE candidate per qualifying gap. A vehicle with multiple
  // future qualifying gaps gets multiple candidates and (after dedup) one
  // WhatsApp per gap_date.
  type GapHit = {
    vehicle: Vehicle;
    nextPickup: Date;
    gapDate: Date;        // legacy single-date (= day before pickup)
    gapStartDate: Date;   // first calendar day of free window
    gapEndDate: Date;     // last calendar day before pickup
    gapHours: number;
  }
  const gapHits: GapHit[] = []
  const nowMs = now.getTime()
  const MIN_GAP_MS = 4 * 3600 * 1000
  const MAX_GAP_MS = 48 * 3600 * 1000

  const considerGap = (vehicle: Vehicle, prevEndMs: number | null, nextStartMs: number) => {
    const freeFromMs = prevEndMs != null ? Math.max(prevEndMs, nowMs) : nowMs
    const gapMs = nextStartMs - freeFromMs
    if (gapMs < MIN_GAP_MS) return
    if (gapMs > MAX_GAP_MS) return
    const gapDate = new Date(nextStartMs - 1)
    gapHits.push({
      vehicle,
      nextPickup: new Date(nextStartMs),
      gapDate,
      gapStartDate: new Date(freeFromMs),
      gapEndDate: gapDate,
      gapHours: Math.round((gapMs / 3600 / 1000) * 10) / 10,
    })
  }

  for (const v of vehicles) {
    const vBookings = bookings
      .filter(b => (b.vehicle_id && b.vehicle_id === v.id)
        || (b.vehicle_plate && v.plate && b.vehicle_plate === v.plate))
      .map(b => ({ ...b, _start: new Date(b.pickup_date).getTime(), _end: new Date(b.dropoff_date).getTime() }))
      .sort((a, b) => a._start - b._start)

    // (a) Imminent gap: from now (or current booking's dropoff) to the next pickup.
    const nextUpcoming = vBookings.find(b => b._start > nowMs && b._start <= horizonEnd.getTime())
    if (nextUpcoming) {
      const currentOrPrev = vBookings.filter(b => b._end <= nextUpcoming._start && b._start <= nowMs).pop()
      considerGap(v, currentOrPrev ? currentOrPrev._end : null, nextUpcoming._start)
    }

    // (b) Gaps between consecutive future bookings (skip the back-to-back
    //     case, the [4h,48h] band already excludes <4h).
    const futureSorted = vBookings.filter(b => b._start <= horizonEnd.getTime())
    for (let i = 0; i + 1 < futureSorted.length; i++) {
      const a = futureSorted[i]
      const b = futureSorted[i + 1]
      // Skip if the "before" booking already ended in the past — that
      // case is covered by branch (a) above with the imminent gap.
      if (a._end <= nowMs) continue
      considerGap(v, a._end, b._start)
    }
  }

  const gapVehicles: Vehicle[] = gapHits.map(h => h.vehicle)

  // For dry-run / single-template formatting we use the FIRST gap's date.
  // When there are multiple vehicles with different gap dates, each
  // outgoing WhatsApp gets its own gap_date (computed inline below).
  const referenceGapDate = gapHits[0]?.gapDate || now
  const fmtShort = (d: Date) => new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d)
  const fmtLong = (d: Date) => new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(d)
  const fmtMedium = (d: Date) => new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: 'numeric', month: 'long',
  }).format(d)
  const gapDateShort = fmtShort(referenceGapDate)
  const gapDateLong = fmtLong(referenceGapDate)
  const gapDateMedium = fmtMedium(referenceGapDate)

  if (dryRun || !recipient) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        dryRun: true,
        count: gapVehicles.length,
        gap_date: gapDateShort,
        vehicles: gapHits.map(h => ({
          id: h.vehicle.id,
          name: h.vehicle.display_name,
          plate: h.vehicle.plate,
          category: h.vehicle.category,
          gap_date: fmtShort(h.gapDate),
          gap_hours: h.gapHours,
          next_pickup: h.nextPickup.toISOString(),
        })),
      }),
    }
  }

  // Resolve template via the standard router (Pro key + label fallbacks).
  // We POST to send-whatsapp-notification so all the existing template
  // resolution + logging stays in one place.
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888'
  let sent = 0
  let failed = 0
  const results: Array<{ vehicle: string; ok: boolean; reason?: string }> = []

  for (const hit of gapHits) {
    const v = hit.vehicle
    // Each vehicle gets its OWN gap_date (the day before the next booking
    // for that specific car). Different vehicles in the same run can have
    // different gap_dates depending on when each one's next booking falls.
    const hitShort = fmtShort(hit.gapDate)
    const hitLong = fmtLong(hit.gapDate)
    const hitMedium = fmtMedium(hit.gapDate)
    // Round gap to a whole number for display ("18 ore" reads cleaner than "18.4 ore").
    const hitHours = Math.round(hit.gapHours)
    // Multi-day gap support: when the free window straddles two
    // calendar days (Europe/Rome), expose both. {gap_dates_range}
    // auto-formats: "28/04/2026" for same-day OR "27/04/2026 → 28/04/2026"
    // for multi-day. Templates that only use {gap_date} still work.
    const startShort = fmtShort(hit.gapStartDate)
    const startLong = fmtLong(hit.gapStartDate)
    const startMedium = fmtMedium(hit.gapStartDate)
    const endShort = hitShort
    const endLong = hitLong
    const endMedium = hitMedium
    const isMultiDay = startShort !== endShort
    const datesRangeShort = isMultiDay ? `${startShort} → ${endShort}` : endShort
    const datesRangeLong = isMultiDay ? `da ${startLong} a ${endLong}` : endLong
    const datesRangeMedium = isMultiDay ? `${startMedium} – ${endMedium}` : endMedium
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/send-whatsapp-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateKey: 'pro_maxi_promo_gap_1gg',
          templateVars: {
            vehicle_specs: v.display_name,
            vehicle: v.display_name,
            veicolo: v.display_name,
            // Single-date placeholders (= last day of the gap window).
            // Backwards compatible with templates that only know {gap_date}.
            date_gap: endShort,
            data_gap: endShort,
            gap_date: endShort,
            date_gap_long: endLong,
            data_gap_long: endLong,
            date_gap_short: endMedium,
            data: endShort,
            // First / last day of the gap (always set, even on single-day gaps).
            gap_date_start: startShort,
            data_gap_start: startShort,
            gap_date_start_long: startLong,
            gap_date_end: endShort,
            data_gap_end: endShort,
            gap_date_end_long: endLong,
            // Auto-formatted range. Renders ONE date when start == end,
            // TWO dates ("dal … al …") when the gap spans two days.
            gap_dates_range: datesRangeShort,
            date_gap_range: datesRangeShort,
            data_gap_range: datesRangeShort,
            gap_dates_range_long: datesRangeLong,
            data_gap_range_long: datesRangeLong,
            gap_dates_range_short: datesRangeMedium,
            // Durata del buco in ore (intero).
            gap_hours: String(hitHours),
            ore: String(hitHours),
            ore_disponibili: String(hitHours),
            durata_ore: String(hitHours),
          },
          customPhone: recipient,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        failed++
        results.push({ vehicle: v.display_name, ok: false, reason: json.message || `HTTP ${res.status}` })
      } else if (json.skipped) {
        failed++
        results.push({ vehicle: v.display_name, ok: false, reason: json.reason || 'template skipped' })
      } else {
        sent++
        results.push({ vehicle: v.display_name, ok: true })
      }
    } catch (err) {
      failed++
      results.push({ vehicle: v.display_name, ok: false, reason: err instanceof Error ? err.message : String(err) })
    }
    // Small delay to be friendly to Green API
    await new Promise(r => setTimeout(r, 800))
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      recipient,
      gapsFound: gapVehicles.length,
      sent,
      failed,
      results,
    }),
  }
}
