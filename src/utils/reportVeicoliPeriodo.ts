/**
 * Report Noleggio per veicolo su un periodo qualsiasi.
 *
 * 25/09/2026: tolto da ReportsTab perche' anche la tab Veicoli mostra gli
 * stessi numeri sul periodo scelto. Un periodo su piu' mesi = un report per
 * mese, ognuno con le sue correzioni, poi la somma (agosto dentro l'anno =
 * report di agosto).
 */
import { loadReportOverrides, type LoadedOverrides } from './reportOverrides'
import { adjustVehicleReport, periodKeyOf } from './reportTotals'

export interface BookingDetail {
  booking_id: string
  customer_name: string
  targa: string
  start_at: string
  end_at: string
  billable_days: number
  days_in_month: number
  total_price: number
  revenue_per_day: number
  payment_status: string
  payment_method: string
  penalty_amount?: number
  danni_amount?: number
  // 2026-06-04: quota di noleggio ancora da saldare (prorata al periodo)
  da_saldare?: number
}

export interface VehicleReport {
  vehicleId: string
  label: string
  plate: string
  category: string
  status?: string
  rentedDays: number
  maintenanceDays: number
  idleDays: number
  utilizationRate: number
  downtimeRate: number
  idleRate: number
  // 2026-05-23: nuovo schema. elapsedDays = giorni trascorsi del periodo
  // (denominatore vero usato per utilizationRate). periodTotalDays = giorni
  // totali del periodo (mostrato come "su X giorni" in tooltip/sub).
  elapsedDays?: number
  periodTotalDays?: number
  // 21/09/2026: presenza in flotta nel periodo (denominatore dell'utilizzo)
  inFlottaDal?: string | null
  inFlottaAl?: string | null
  giorniInFlotta?: number
  inFlottaDalManuale?: boolean
  giorniInPausa?: number
  pause?: { dal: string; al: string; motivo: string }[]
  nonInFlotta?: boolean
  bookingsCount: number
  rentalRevenue: number
  penaltyRevenue: number
  danniRevenue: number
  // 2026-06-04: quota noleggio non incassata (da saldare), prorata al periodo
  daSaldareRevenue?: number
  totalRevenue: number
  // 2026-05-24: incassi anticipati per veicolo
  anticipatedRevenue?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anticipatedBookings?: AnticipatedBooking[]
  bookings?: BookingDetail[]
}

export interface UnmatchedBooking {
  id: string
  vehicle_name: string
  vehicle_plate: string
  vehicle_id: string
}

export interface AnticipatedBooking {
  booking_id: string
  customer_name: string
  targa: string
  pickup_date: string
  dropoff_date: string
  total_price: number
  paid_at: string
  payment_method: string
}

export interface VehicleReportData {
  month: string
  daysInMonth: number
  vehicleCount: number
  totalBookingsFound: number
  unmatchedBookings?: UnmatchedBooking[]
  totalRentalRevenue: number
  totalPenaltyRevenue: number
  totalDanniRevenue: number
  // 2026-06-04: totale noleggio ancora da saldare (somma prorata)
  totalDaSaldare?: number
  totalRevenue: number
  // 2026-05-24: incassi anticipati = pagati nel periodo ma rental futuro
  totalAnticipatedRevenue?: number
  anticipatedBookingsCount?: number
  avgUtilizationRate: number
  // Contratti creati nel periodo, dello stesso business del report
  contratti?: { totale: number; firmati: number; daFirmare: number }
  vehicles: VehicleReport[]
  // 23/09/2026: periodo su piu' mesi = un report per mese, ognuno con le sue
  // correzioni; qui restano i singoli mesi (per i grafici), sopra la somma.
  mesi?: { da: string; a: string; dati: VehicleReportData }[]
}

/** Spezza il periodo nei mesi di calendario che tocca (estremi tagliati). */
export function mesiDelPeriodo(from: string, to: string): { da: string; a: string }[] {
  const out: { da: string; a: string }[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || to < from) return out
  let [y, m] = from.split('-').map(Number)
  for (let i = 0; i < 240; i++) {
    const primo = `${y}-${String(m).padStart(2, '0')}-01`
    const ultimo = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
    if (primo > to) break
    out.push({ da: primo < from ? from : primo, a: ultimo > to ? to : ultimo })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/**
 * Somma dei report mensili: ogni numero del periodo e' la somma dei mesi,
 * cosi' agosto dentro l'anno e' identico al report di agosto (correzioni a
 * mano comprese). Prima l'anno era un report unico che leggeva solo le
 * correzioni del primo mese e agosto usciva diverso.
 */
export function sommaMesi(mesi: { da: string; a: string; dati: VehicleReportData }[], from: string, to: string): VehicleReportData {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const somma = (k: keyof VehicleReportData) => r2(mesi.reduce((t, m) => t + (Number(m.dati[k]) || 0), 0))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perVeicolo = new Map<string, any>()
  for (const { dati } of mesi) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const v of dati.vehicles as any[]) {
      const chiave = String(v.vehicleId || v._manualId || v.label)
      // Giorni noleggiati/fermi/liberi del mese: si sommano i giorni, non le %.
      const inFlotta = Number(v.giorniInFlotta) || 0
      const noleggiati = (Number(v.utilizationRate) || 0) * inFlotta
      const fermi = (Number(v.downtimeRate) || 0) * inFlotta
      const liberi = (Number(v.idleRate) || 0) * inFlotta
      const g = perVeicolo.get(chiave)
      if (!g) {
        perVeicolo.set(chiave, {
          ...v,
          bookings: (v.bookings || []).map((b: BookingDetail) => ({ ...b })),
          anticipatedBookings: [...(v.anticipatedBookings || [])],
          pause: [...(v.pause || [])],
          _noleggiati: noleggiati, _fermi: fermi, _liberi: liberi,
        })
        continue
      }
      for (const k of ['rentedDays', 'maintenanceDays', 'idleDays', 'elapsedDays', 'periodTotalDays', 'giorniInFlotta', 'giorniInPausa',
        'rentalRevenue', 'penaltyRevenue', 'danniRevenue', 'daSaldareRevenue', 'totalRevenue', 'anticipatedRevenue']) {
        g[k] = r2((Number(g[k]) || 0) + (Number(v[k]) || 0))
      }
      g._noleggiati += noleggiati; g._fermi += fermi; g._liberi += liberi
      g.nonInFlotta = !!g.nonInFlotta && !!v.nonInFlotta
      if (!g.inFlottaDal) g.inFlottaDal = v.inFlottaDal
      if (v.inFlottaAl) g.inFlottaAl = v.inFlottaAl
      g.pause.push(...(v.pause || []))
      g.anticipatedBookings.push(...(v.anticipatedBookings || []))
      // Prenotazione a cavallo di due mesi: una riga sola, giorni e importi sommati.
      for (const b of (v.bookings || []) as BookingDetail[]) {
        const gia = g.bookings.find((x: BookingDetail) => x.booking_id === b.booking_id)
        if (!gia) { g.bookings.push({ ...b }); continue }
        gia.days_in_month = (Number(gia.days_in_month) || 0) + (Number(b.days_in_month) || 0)
        gia.penalty_amount = r2((Number(gia.penalty_amount) || 0) + (Number(b.penalty_amount) || 0))
        gia.danni_amount = r2((Number(gia.danni_amount) || 0) + (Number(b.danni_amount) || 0))
        gia.da_saldare = r2((Number(gia.da_saldare) || 0) + (Number(b.da_saldare) || 0))
      }
    }
  }
  const vehicles = [...perVeicolo.values()].map(g => {
    const den = Number(g.giorniInFlotta) || 0
    const ids = new Set<string>([...g.bookings, ...g.anticipatedBookings].map((b: { booking_id: string }) => b.booking_id))
    const { _noleggiati, _fermi, _liberi, ...v } = g
    return {
      ...v,
      bookingsCount: ids.size,
      utilizationRate: den > 0 ? Math.min(1, r2(_noleggiati / den)) : 0,
      downtimeRate: den > 0 ? Math.min(1, r2(_fermi / den)) : 0,
      idleRate: den > 0 ? Math.min(1, r2(_liberi / den)) : 0,
    } as VehicleReport
  })
  const nonAbbinata = (v: VehicleReport) => !!(v as { unmatched?: boolean }).unmatched
  const prenotazioni = new Set<string>()
  for (const v of vehicles) for (const b of [...(v.bookings || []), ...(v.anticipatedBookings || [])]) prenotazioni.add(b.booking_id)
  const nonAbbinate = new Map<string, UnmatchedBooking>()
  for (const { dati } of mesi) for (const u of dati.unmatchedBookings || []) nonAbbinate.set(u.id, u)
  const reali = vehicles.filter(v => !nonAbbinata(v) && !v.nonInFlotta)
  const conContratti = mesi.filter(m => m.dati.contratti)
  return {
    month: `${from}_${to}`,
    daysInMonth: somma('daysInMonth'),
    vehicleCount: vehicles.filter(v => !nonAbbinata(v)).length,
    totalBookingsFound: prenotazioni.size,
    unmatchedBookings: nonAbbinate.size > 0 ? [...nonAbbinate.values()] : undefined,
    totalRentalRevenue: somma('totalRentalRevenue'),
    totalPenaltyRevenue: somma('totalPenaltyRevenue'),
    totalDanniRevenue: somma('totalDanniRevenue'),
    totalDaSaldare: somma('totalDaSaldare'),
    totalRevenue: somma('totalRevenue'),
    totalAnticipatedRevenue: somma('totalAnticipatedRevenue'),
    anticipatedBookingsCount: somma('anticipatedBookingsCount'),
    avgUtilizationRate: r2(reali.reduce((t, v) => t + v.utilizationRate, 0) / Math.max(1, reali.length)),
    contratti: conContratti.length > 0 ? {
      totale: conContratti.reduce((t, m) => t + (m.dati.contratti?.totale || 0), 0),
      firmati: conContratti.reduce((t, m) => t + (m.dati.contratti?.firmati || 0), 0),
      daFirmare: conContratti.reduce((t, m) => t + (m.dati.contratti?.daFirmare || 0), 0),
    } : undefined,
    vehicles,
    mesi,
  }
}

/**
 * Il Report Noleggio per veicolo di da..a, correzioni a mano comprese: la
 * stessa strada del Report Terra, cosi' Veicoli e Report danno gli stessi numeri.
 */
export async function caricaReportVeicoli(from: string, to: string, business = 'rental'): Promise<{ dati: VehicleReportData; overrides: LoadedOverrides }> {
  const bizParam = business && business !== 'rental' ? `&business=${encodeURIComponent(business)}` : ''
  const overrideScope = business === 'rental' ? 'noleggio' : `noleggio_${business}`
  const aggiusta = (d: VehicleReportData, ov: LoadedOverrides, da: string): VehicleReportData => {
    const { vehicles, totals } = adjustVehicleReport((d.vehicles || []), ov, periodKeyOf(da))
    return {
      ...d,
      vehicles,
      totalRentalRevenue: totals.totalRentalRevenue,
      totalPenaltyRevenue: totals.totalPenaltyRevenue,
      totalDanniRevenue: totals.totalDanniRevenue,
      totalDaSaldare: totals.totalDaSaldare,
      totalRevenue: totals.totalRevenue,
      totalAnticipatedRevenue: totals.totalAnticipatedRevenue,
    }
  }
  const leggi = async (da: string, a: string): Promise<VehicleReportData> => {
    const r = await fetch(`/.netlify/functions/monthly-report?type=vehicles&from=${da}&to=${a}${bizParam}`)
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'Errore nel caricamento')
    return d
  }
  const mesiPeriodo = mesiDelPeriodo(from, to)
  if (mesiPeriodo.length > 1) {
    const [ov, risposte] = await Promise.all([
      loadReportOverrides(overrideScope),
      Promise.all(mesiPeriodo.map(m => leggi(m.da, m.a))),
    ])
    const mesi = risposte.map((d, i) => ({ ...mesiPeriodo[i], dati: aggiusta(d, ov, mesiPeriodo[i].da) }))
    return { dati: sommaMesi(mesi, from, to), overrides: ov }
  }
  // Chiave MENSILE delle correzioni, non la plage esatta (vedi ReportsTab).
  const [d, ov] = await Promise.all([leggi(from, to), loadReportOverrides(overrideScope)])
  return { dati: aggiusta(d, ov, from), overrides: ov }
}
