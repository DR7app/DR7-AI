/**
 * Veicolo per tratto di una prenotazione (06/11/2026).
 *
 * Un'estensione con cambio auto resta UNA prenotazione: la riga `bookings`
 * porta il veicolo NUOVO (vehicle_id / vehicle_name / vehicle_plate) e la
 * nuova riconsegna, mentre il veicolo precedente e il momento del cambio
 * restano solo in `booking_details.extension_history[]`
 * (previous_vehicle_*, new_vehicle_*, previous_dropoff).
 *
 * Il Calendario Noleggio Terra legge la riga e mostra il veicolo nuovo; il
 * Calendario Giornaliero invece ragiona per eventi (ritiro/rientro) e nel
 * giorno del cambio non vedeva niente: il ritiro originale e la riconsegna
 * finale cadono in altri giorni. Staff 06/11: Andrea Pili, A45 -> RS3 in
 * estensione, l'uscita della RS3 non compariva.
 *
 * Qui la prenotazione si ricostruisce come elenco di tratti
 * [{veicolo, da, a}]: il primo parte dal ritiro, ogni cambio chiude il tratto
 * precedente alla vecchia riconsegna e ne apre uno nuovo, l'ultimo e' il
 * veicolo della riga fino alla riconsegna attuale. Senza cambi auto c'e' un
 * solo tratto, identico alla riga.
 */

export interface VehicleSegment {
  vehicleId: string | null
  name: string
  plate: string | null
  /** ISO, inizio del tratto (ritiro o momento del cambio). */
  from: string | null
  /** ISO, fine del tratto (momento del cambio o riconsegna). */
  to: string | null
}

interface ExtensionEntry {
  previous_dropoff?: string | null
  previous_vehicle_id?: string | null
  previous_vehicle_name?: string | null
  previous_vehicle_plate?: string | null
  new_vehicle_id?: string | null
  new_vehicle_name?: string | null
  new_vehicle_plate?: string | null
}

const s = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : ''
  return t || null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vehicleSegments(booking: any): VehicleSegment[] {
  const bd = booking?.booking_details || {}
  const rigaVeicolo = {
    vehicleId: s(booking?.vehicle_id) || s(bd.vehicle_id) || s(bd.vehicle?.id),
    name: s(booking?.vehicle_name) || s(bd.vehicle?.name) || '',
    plate: s(booking?.vehicle_plate) || s(bd.vehicle?.targa) || s(bd.vehicle?.plate),
  }
  const pickup = s(booking?.pickup_date)
  const dropoff = s(booking?.dropoff_date)

  const storia: ExtensionEntry[] = Array.isArray(bd.extension_history) ? bd.extension_history : []
  const cambi = storia
    .filter(e => e && s(e.previous_dropoff) && (s(e.new_vehicle_id) || s(e.new_vehicle_name)))
    .filter(e => {
      // Un "cambio" verso lo stesso mezzo non e' un cambio.
      const prima = s(e.previous_vehicle_id), dopo = s(e.new_vehicle_id)
      return !(prima && dopo && prima === dopo)
    })
    .filter(e => {
      const t = Date.parse(String(e.previous_dropoff))
      if (!Number.isFinite(t)) return false
      // Un cambio fuori dal periodo del noleggio non apre un tratto.
      if (pickup && t <= Date.parse(pickup)) return false
      if (dropoff && t >= Date.parse(dropoff)) return false
      return true
    })
    .sort((a, b) => Date.parse(String(a.previous_dropoff)) - Date.parse(String(b.previous_dropoff)))

  if (cambi.length === 0) return [{ ...rigaVeicolo, from: pickup, to: dropoff }]

  const out: VehicleSegment[] = []
  let inizio = pickup
  for (let i = 0; i < cambi.length; i++) {
    const c = cambi[i]
    const fine = s(c.previous_dropoff)
    // Il veicolo del tratto che si chiude: quello che il cambio dichiara di
    // lasciare; se manca, quello che il cambio precedente aveva preso.
    const prec = i > 0 ? cambi[i - 1] : null
    out.push({
      vehicleId: s(c.previous_vehicle_id) || (prec ? s(prec.new_vehicle_id) : null),
      name: s(c.previous_vehicle_name) || (prec ? s(prec.new_vehicle_name) : null) || '',
      plate: s(c.previous_vehicle_plate) || (prec ? s(prec.new_vehicle_plate) : null),
      from: inizio,
      to: fine,
    })
    inizio = fine
  }
  // Ultimo tratto: il veicolo della riga (quello che ha anche la targa sicura).
  const ultimo = cambi[cambi.length - 1]
  out.push({
    vehicleId: rigaVeicolo.vehicleId || s(ultimo.new_vehicle_id),
    name: rigaVeicolo.name || s(ultimo.new_vehicle_name) || '',
    plate: rigaVeicolo.plate || s(ultimo.new_vehicle_plate),
    from: inizio,
    to: dropoff,
  })
  return out
}

/**
 * Le estensioni salvate prima del 06/11/2026 non hanno la targa del veicolo
 * precedente. Si completa dall'anagrafica veicoli (solo quelle mancanti).
 */
export async function completaTargheSegmenti<T extends { segment?: { vehicleId: string | null; plate: string | null } }>(
  righe: T[],
  targhePerId: (ids: string[]) => Promise<Record<string, string>>,
): Promise<T[]> {
  const ids = Array.from(new Set(righe
    .filter(r => r.segment && !r.segment.plate && r.segment.vehicleId)
    .map(r => r.segment!.vehicleId as string)))
  if (ids.length === 0) return righe
  let mappa: Record<string, string> = {}
  try { mappa = await targhePerId(ids) } catch { return righe }
  return righe.map(r => (r.segment && !r.segment.plate && r.segment.vehicleId && mappa[r.segment.vehicleId])
    ? { ...r, segment: { ...r.segment, plate: mappa[r.segment.vehicleId] } }
    : r)
}
