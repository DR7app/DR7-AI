import { describe, it, expect } from 'vitest'
import { vehicleSegments, completaTargheSegmenti } from './vehicleSegments'
import { expandDayBooking, dailyBookingTime } from './dailyCalendarCategories'
import { getRomeDateComponents } from './timezoneUtils'

// Caso staff 06/11/2026: A45 dal 01/11 10:30, estensione al 06/11 con cambio
// in RS3 al momento della vecchia riconsegna (03/11 11:00 Roma = 10:00 UTC).
const pili = {
  id: 'b1',
  service_type: 'car_rental',
  customer_name: 'Andrea Pili',
  vehicle_id: 'rs3',
  vehicle_name: 'Audi RS3',
  vehicle_plate: 'GZ333RS',
  pickup_date: '2026-11-01T09:30:00.000Z',
  dropoff_date: '2026-11-06T16:00:00.000Z',
  booking_details: {
    pickupTime: '10:30',
    returnTime: '11:00',
    vehicle: { id: 'rs3', name: 'Audi RS3', plate: 'GZ333RS' },
    extension_history: [{
      previous_dropoff: '2026-11-03T10:00:00.000Z',
      new_dropoff: '2026-11-06T16:00:00.000Z',
      previous_vehicle_id: 'a45',
      previous_vehicle_name: 'Mercedes A45',
      new_vehicle_id: 'rs3',
      new_vehicle_name: 'Audi RS3',
    }],
  },
}

const giorno = (ymd: string) => (iso?: string) => {
  if (!iso) return false
  const c = getRomeDateComponents(iso)
  const [y, m, d] = ymd.split('-').map(Number)
  return c.year === y && c.month === m && c.day === d
}

describe('vehicleSegments', () => {
  it('senza cambio auto: un solo tratto uguale alla riga', () => {
    const b = { ...pili, booking_details: { ...pili.booking_details, extension_history: [{ previous_dropoff: '2026-11-03T10:00:00.000Z', new_dropoff: '2026-11-06T16:00:00.000Z' }] } }
    expect(vehicleSegments(b)).toEqual([
      { vehicleId: 'rs3', name: 'Audi RS3', plate: 'GZ333RS', from: pili.pickup_date, to: pili.dropoff_date },
    ])
  })

  it('cambio auto in estensione: A45 fino al cambio, RS3 dopo', () => {
    expect(vehicleSegments(pili)).toEqual([
      { vehicleId: 'a45', name: 'Mercedes A45', plate: null, from: pili.pickup_date, to: '2026-11-03T10:00:00.000Z' },
      { vehicleId: 'rs3', name: 'Audi RS3', plate: 'GZ333RS', from: '2026-11-03T10:00:00.000Z', to: pili.dropoff_date },
    ])
  })

  it('due cambi: tre tratti in ordine', () => {
    const b = {
      ...pili,
      booking_details: {
        ...pili.booking_details,
        extension_history: [
          { previous_dropoff: '2026-11-05T10:00:00.000Z', previous_vehicle_id: 'm3', previous_vehicle_name: 'BMW M3', new_vehicle_id: 'rs3', new_vehicle_name: 'Audi RS3' },
          { previous_dropoff: '2026-11-03T10:00:00.000Z', previous_vehicle_id: 'a45', previous_vehicle_name: 'Mercedes A45', previous_vehicle_plate: 'AA045AA', new_vehicle_id: 'm3', new_vehicle_name: 'BMW M3', new_vehicle_plate: 'MM003MM' },
        ],
      },
    }
    expect(vehicleSegments(b).map(s => [s.name, s.plate, s.to])).toEqual([
      ['Mercedes A45', 'AA045AA', '2026-11-03T10:00:00.000Z'],
      ['BMW M3', 'MM003MM', '2026-11-05T10:00:00.000Z'],
      ['Audi RS3', 'GZ333RS', pili.dropoff_date],
    ])
  })
})

describe('expandDayBooking: Calendario Giornaliero', () => {
  it('giorno del cambio: rientro A45 e uscita RS3 all\'ora della vecchia riconsegna', () => {
    const ev = expandDayBooking(pili, giorno('2026-11-03'))
    expect(ev.map(e => [e.type, e.segment?.name, dailyBookingTime(e, e.type)])).toEqual([
      ['check-out', 'Mercedes A45', '11:00'],
      ['check-in', 'Audi RS3', '11:00'],
    ])
    // La riga resta quella vera: la scheda che si apre e' la prenotazione.
    expect(ev[1].vehicle_name).toBe('Audi RS3')
    expect(ev[0].id).toBe('b1')
  })

  it('giorno del ritiro: esce la A45 all\'ora del ritiro', () => {
    const ev = expandDayBooking(pili, giorno('2026-11-01'))
    expect(ev.map(e => [e.type, e.segment?.name, dailyBookingTime(e, e.type)])).toEqual([
      ['check-in', 'Mercedes A45', '10:30'],
    ])
  })

  it('giorno della riconsegna finale: rientra la RS3 all\'ora nuova, non al returnTime vecchio', () => {
    const ev = expandDayBooking(pili, giorno('2026-11-06'))
    expect(ev.map(e => [e.type, e.segment?.name, dailyBookingTime(e, e.type)])).toEqual([
      ['check-out', 'Audi RS3', '17:00'],
    ])
  })

  it('giorno intermedio: nessun evento', () => {
    expect(expandDayBooking(pili, giorno('2026-11-04'))).toEqual([])
  })

  it('senza cambio auto resta identico a prima (nessun segment)', () => {
    const b = { ...pili, booking_details: { pickupTime: '10:30', returnTime: '18:30' } }
    const ev = expandDayBooking(b, giorno('2026-11-06'))
    expect(ev).toHaveLength(1)
    expect(ev[0].segment).toBeUndefined()
    expect(dailyBookingTime(ev[0], ev[0].type)).toBe('18:30')
  })

  it('completa la targa mancante del veicolo precedente dall\'anagrafica', async () => {
    const ev = expandDayBooking(pili, giorno('2026-11-03'))
    const out = await completaTargheSegmenti(ev, async ids => {
      expect(ids).toEqual(['a45'])
      return { a45: 'AA045AA' }
    })
    expect(out.map(e => e.segment?.plate)).toEqual(['AA045AA', 'GZ333RS'])
  })
})
