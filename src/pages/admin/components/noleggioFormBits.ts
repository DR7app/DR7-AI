// Pezzi condivisi fra i form di prenotazione dei noleggi Mare/Aria:
// NoleggioServiceTab (form lean) e MareBookingModal (modale completa, allineata
// al Noleggio Terra). Stanno qui e non dentro un tab per evitare import
// circolari fra i due file.
//
// Regole DR7 rispettate da questi helper:
//  - orario SEMPRE 24h: niente <input type="time"> (con locale di sistema non
//    italiano il browser lo rende AM/PM);
//  - gli orari fuori dagli orari ufficio si SEGNALANO, non si bloccano
//    (nessun hard-block: ogni limite è al massimo un OTP override);
//  - gli orari ufficio arrivano da Centralina Pro > Orari Noleggio.
import type { CSSProperties } from 'react'
import { isWithinOfficeHoursForDate, getOfficeMinuteRangesForDate } from '../../../utils/noleggioHours'

export const INPUT_CLS = 'px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm w-full placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold'

// Griglia da 15 minuti su 24h — la stessa del Noleggio Terra (ReservationsTab).
export const TIME_SLOTS: string[] = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
)

const FLAGGED_TIME_STYLE: CSSProperties = { color: 'white', backgroundColor: '#dc2626', fontWeight: 600 }
const NORMAL_TIME_STYLE: CSSProperties = { color: 'black', backgroundColor: 'white' }

// `serviceType` sceglie la riga di Centralina da cui leggere gli orari:
// Mare/Aria/Soggiorni hanno i loro. Omesso = Noleggio Terra (roadmap #16).
export function isOutOfHours(dateStr: string, time: string, kind: 'pickup' | 'return', serviceType?: string | null): boolean {
  if (!dateStr || !time) return false
  return !isWithinOfficeHoursForDate(dateStr, time, kind, serviceType)
}

// Opzioni per la select dell'ora. Se l'orario già salvato non cade sulla
// griglia dei 15' (prenotazioni vecchie, import) viene aggiunto in testa: così
// aprendo "Modifica" l'orario esistente non viene perso.
export function buildTimeOptions(dateStr: string, kind: 'pickup' | 'return', current?: string, serviceType?: string | null) {
  const slots = current && !TIME_SLOTS.includes(current) ? [current, ...TIME_SLOTS] : TIME_SLOTS
  return slots.map(v => {
    const flagged = isOutOfHours(dateStr, v, kind, serviceType)
    return { value: v, label: flagged ? `🔴 ${v}  FUORI ORARIO` : v, style: flagged ? FLAGGED_TIME_STYLE : NORMAL_TIME_STYLE }
  })
}

// "10:30–12:30 / 16:30–18:30", oppure null se quel giorno la sede è chiusa.
export function officeHoursLabel(dateStr: string, kind: 'pickup' | 'return', serviceType?: string | null): string | null {
  if (!dateStr) return null
  const ranges = getOfficeMinuteRangesForDate(dateStr, kind, serviceType)
  if (ranges.length === 0) return null
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return ranges.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(' / ')
}

// Giorni di noleggio — stessa formula del Noleggio Terra (PreventiviTab):
// differenza arrotondata per eccesso sulle 24h, minimo 1. Torna 0 se la
// riconsegna non è successiva al ritiro (dati non validi).
export function rentalDaysBetween(pd: string, pt: string, dd: string, dt: string): number {
  if (!pd || !dd) return 0
  const a = new Date(`${pd}T${pt || '00:00'}:00`)
  const b = new Date(`${dd}T${dt || '00:00'}:00`)
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b.getTime() <= a.getTime()) return 0
  return Math.max(1, Math.ceil((b.getTime() - a.getTime()) / 86_400_000))
}

// yyyy-mm-dd + n giorni (mezzogiorno: immune ai cambi di ora legale).
export function addDaysYmd(ymd: string, n: number): string {
  if (!ymd) return ''
  const d = new Date(`${ymd}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

// Offset (minuti) del fuso Europe/Rome per una data yyyy-mm-dd: +60 (CET) o
// +120 (CEST). Calcolato confrontando la stessa istante in Rome vs UTC.
export function romeOffsetMinutes(ymd: string): number {
  const noonUtc = new Date(`${ymd}T12:00:00Z`)
  const romeHour = parseInt(noonUtc.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Rome' }).slice(0, 2), 10)
  return (romeHour - 12) * 60
}

// data + ora digitate come ora locale Rome -> ISO UTC (come si salva su bookings).
export function toRomeIso(date: string, time: string): string | null {
  if (!date) return null
  const off = romeOffsetMinutes(date)
  const utcMs = Date.UTC(
    Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)),
    Number((time || '00:00').slice(0, 2)), Number((time || '00:00').slice(3, 5)),
  ) - off * 60_000
  return new Date(utcMs).toISOString()
}

export function eurToCents(s: string): number {
  const n = parseFloat((s || '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
export function centsToEur(c: number): string {
  return ((Number(c) || 0) / 100).toFixed(2)
}
export function eur(cents: number | null | undefined): string {
  return ((Number(cents) || 0) / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}
