import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Guardia sul trigger prevent_overlapping_bookings (05/10/2026, Fanni/Mainas
// PAB3550): il conflitto accettato col popup deve valere per ENTRAMBE le
// prenotazioni, e "Pagato" non deve mai rifare il controllo. Se una nuova
// migrazione riscrive la funzione senza queste due regole, questo test fallisce.
const dir = join(__dirname, '../../supabase/migrations')
const ultima = readdirSync(dir)
  .filter(f => f.endsWith('.sql'))
  .sort()
  .filter(f => /FUNCTION\s+public\.prevent_overlapping_bookings/i.test(readFileSync(join(dir, f), 'utf8')))
  .pop()!
const sql = readFileSync(join(dir, ultima), 'utf8').replace(/\s+/g, ' ')

describe(`prevent_overlapping_bookings (${ultima})`, () => {
  it('una prenotazione forzata non fa conflitto all\'altra', () => {
    expect(sql).toMatch(/AND COALESCE\(booking_details->>'allow_double_booking', ''\) <> 'true'/)
  })

  it('pagato/conferma senza cambiare date o veicolo non rifa il controllo', () => {
    expect(sql).toMatch(/TG_OP = 'UPDATE'/)
    expect(sql).toMatch(/NEW\.pickup_date IS NOT DISTINCT FROM OLD\.pickup_date/)
    expect(sql).toMatch(/NEW\.dropoff_date IS NOT DISTINCT FROM OLD\.dropoff_date/)
    expect(sql).toMatch(/NEW\.vehicle_id IS NOT DISTINCT FROM OLD\.vehicle_id/)
    expect(sql).toMatch(/NEW\.vehicle_plate IS NOT DISTINCT FROM OLD\.vehicle_plate/)
  })
})
