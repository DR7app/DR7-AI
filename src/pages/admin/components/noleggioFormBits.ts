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

/* --- Stili e testi condivisi anche dalle viste Preventivi (Mare/Aria/
 * Soggiorni e Lavaggio). Stanno in questo file .ts, non accanto ai componenti:
 * un modulo che esporta sia costanti sia componenti rompe il fast refresh. --- */

export const BTN_PRIMARY = 'px-4 py-2 rounded-full bg-dr7-gold text-white text-sm font-semibold hover:bg-[#0A8FA3] transition-colors disabled:opacity-50'
export const BTN_GHOST = 'px-3 py-1.5 rounded-lg border border-theme-border text-theme-text-secondary text-sm hover:bg-theme-bg-hover'

export const STATUS_BADGE: Record<string, string> = {
  confirmed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  confermata: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  active: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  completed: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  completata: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  cancelled: 'bg-red-500/15 text-red-400 border-red-500/30',
  annullata: 'bg-red-500/15 text-red-400 border-red-500/30',
  bozza: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  inviato: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  accettato: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rifiutato: 'bg-red-500/15 text-red-400 border-red-500/30',
  convertito: 'bg-dr7-gold/15 text-dr7-gold border-dr7-gold/30',
}

/**
 * 2026-08-24: prima bastava che il messaggio CONTENESSE "noleggio_catalog"
 * per dire "tabelle non ancora create". Cosi' un vincolo violato o un
 * permesso RLS — errori veri, con una causa precisa — venivano raccontati
 * come una migration mancante: si andava a cercare una tabella che c'era
 * gia'. Ora si distingue per codice, e il messaggio del database resta
 * sempre visibile in coda.
 */
export function missingTableHint(msg: string, code?: string): string {
  const dettaglio = msg ? ` (dettaglio: ${msg})` : ''
  if (code === '42P01' || code === 'PGRST205' || /relation .* does not exist|could not find the table|schema cache/i.test(msg)) {
    return `Tabella non ancora creata: esegui la migration Stage 2 (noleggio_catalog / noleggio_preventivi) nel SQL editor Supabase.${dettaglio}`
  }
  if (code === '23514' || /violates check constraint/i.test(msg)) {
    return `Il database non accetta questo valore: un vincolo (CHECK) lo esclude. Se hai appena aggiunto un nuovo tipo di servizio, va allargato il vincolo.${dettaglio}`
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return `Permessi insufficienti su questa tabella (RLS): l'utente admin non e' autorizzato a scrivere.${dettaglio}`
  }
  if (code === '23505') return `Esiste gia' un elemento con questi dati.${dettaglio}`
  if (code === '42703') return `Colonna mancante: la tabella e' piu' vecchia del gestionale, manca una migration.${dettaglio}`
  return msg
}
