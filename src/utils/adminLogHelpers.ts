/**
 * Helpers that build rich "details" objects for logAdminAction calls so the
 * Storico (OperatoriTab) shows *what* was affected, not just an opaque UUID.
 *
 * Each builder returns an object with snake_case keys that OperatoriTab maps
 * to Italian labels via DETAIL_LABELS.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

function isoOrRaw(v: unknown): string | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString()
  return undefined
}

export function buildBookingContext(b: AnyObj | null | undefined): AnyObj {
  if (!b) return {}
  return compact({
    customer: b.customer_name,
    customer_email: b.customer_email,
    vehicle: b.vehicle_name,
    plate: b.vehicle_plate || b.booking_details?.vehicle_plate,
    pickup_date: isoOrRaw(b.pickup_date),
    dropoff_date: isoOrRaw(b.dropoff_date),
    status: b.status,
    total: b.booking_details?.total_price ?? b.total_price,
  })
}

export function buildCarWashContext(b: AnyObj | null | undefined): AnyObj {
  if (!b) return {}
  return compact({
    customer: b.customer_name,
    service: b.booking_details?.service_name || b.booking_details?.service,
    appointment_date: isoOrRaw(b.booking_details?.appointment_date || b.pickup_date),
    appointment_time: b.booking_details?.appointment_time,
    total: b.booking_details?.total_price ?? b.total_price,
  })
}

export function buildMechanicalContext(b: AnyObj | null | undefined): AnyObj {
  if (!b) return {}
  return compact({
    customer: b.customer_name,
    service: b.booking_details?.service_name || b.booking_details?.service,
    appointment_date: isoOrRaw(b.booking_details?.appointment_date || b.pickup_date),
    appointment_time: b.booking_details?.appointment_time,
    vehicle: b.vehicle_name,
    plate: b.vehicle_plate,
    total: b.booking_details?.total_price ?? b.total_price,
  })
}

export function buildFatturaContext(f: AnyObj | null | undefined): AnyObj {
  if (!f) return {}
  return compact({
    fattura_number: f.numero_fattura,
    customer: f.customer_name,
    amount: f.importo_totale,
    tipo: f.tipo_fattura,
    sdi_status: f.sdi_status,
  })
}

export function buildCustomerContext(c: AnyObj | null | undefined): AnyObj {
  if (!c) return {}
  const full = [c.cognome, c.nome].filter(Boolean).join(' ')
  return compact({
    customer: full || c.denominazione || c.ragione_sociale,
    email: c.email,
    phone: c.telefono,
    codice_fiscale: c.codice_fiscale,
  })
}

/**
 * Build a compact diff of changed fields between before/after objects.
 * Returns undefined if no changes, otherwise an object like:
 *   { field_name: "old → new", other: "x → y" }
 * Only includes keys listed in `watch`, to avoid logging every minor field.
 */
export function buildDiff(
  before: AnyObj | null | undefined,
  after: AnyObj | null | undefined,
  watch: string[]
): AnyObj | undefined {
  if (!before || !after) return undefined
  const diff: AnyObj = {}
  for (const key of watch) {
    const a = before[key]
    const b = after[key]
    if (serialize(a) !== serialize(b)) {
      diff[key] = `${serialize(a) || '—'} → ${serialize(b) || '—'}`
    }
  }
  return Object.keys(diff).length ? diff : undefined
}

function serialize(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function compact(obj: AnyObj): AnyObj {
  const out: AnyObj = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}
