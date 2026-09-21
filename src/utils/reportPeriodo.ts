// Periodo dei Report visto da fuori: il report aperto dice che periodo mostra,
// se sta caricando, e accetta un periodo imposto. Serve al PDF (le date del
// periodo in testa) e al PDF mese per mese (il report si porta su ogni mese,
// si aspetta il caricamento, si stampa).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface Periodo { from: string; to: string } // YYYY-MM-DD, inclusi

export interface ControlloPeriodo {
  /** Porta il report su questo periodo (come se l'utente lo scegliesse). */
  imposta: (from: string, to: string) => void
  /** Periodo mostrato adesso; null = "tutto", senza date. */
  periodo: () => Periodo | null
  inCaricamento: () => boolean
  /** Solo i report che dividono una tabella in pagine: tutte le righe per il PDF. */
  preparaPdf?: (attivo: boolean) => void
}

let attuale: ControlloPeriodo | null = null
const ascoltatori = new Set<() => void>()
const avvisa = () => ascoltatori.forEach(f => f())

export function controlloPeriodoAttuale(): ControlloPeriodo | null {
  return attuale
}

/** Per chi disegna il pulsante: si ridisegna quando si apre/chiude un report col periodo. */
export function useControlloPeriodoReport(): ControlloPeriodo | null {
  const [c, setC] = useState<ControlloPeriodo | null>(attuale)
  useEffect(() => {
    const f = () => setC(attuale)
    ascoltatori.add(f)
    f()
    return () => { ascoltatori.delete(f) }
  }, [])
  return c
}

/** Da chiamare in ogni report che ha un periodo. */
export function useRegistraPeriodoReport(dati: {
  imposta: (from: string, to: string) => void
  periodo: Periodo | null
  inCaricamento: boolean
  preparaPdf?: (attivo: boolean) => void
}) {
  const ref = useRef(dati)
  useLayoutEffect(() => { ref.current = dati })
  useEffect(() => {
    const ctrl: ControlloPeriodo = {
      imposta: (f, t) => ref.current.imposta(f, t),
      periodo: () => ref.current.periodo,
      inCaricamento: () => ref.current.inCaricamento,
      preparaPdf: (a) => ref.current.preparaPdf?.(a),
    }
    attuale = ctrl
    avvisa()
    return () => {
      if (attuale === ctrl) { attuale = null; avvisa() }
    }
  }, [])
}

export function isoLocale(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function periodoDelMese(yyyyMm: string): Periodo {
  const [y, m] = yyyyMm.split('-').map(Number)
  return { from: isoLocale(new Date(y, m - 1, 1)), to: isoLocale(new Date(y, m, 0)) }
}

export function dataItaliana(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const attesa = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Aspetta che il report abbia finito di ricaricare dopo un cambio di periodo:
 * prima gli si lascia il tempo di partire, poi si aspetta che il caricamento
 * resti spento per un attimo (alcuni report caricano a ondate).
 */
export async function aspettaReportPronto(c: ControlloPeriodo, maxMs = 90000) {
  const inizio = Date.now()
  let partito = false
  while (Date.now() - inizio < 1500) {
    if (c.inCaricamento()) { partito = true; break }
    await attesa(100)
  }
  void partito
  let fermoDa = Date.now()
  while (Date.now() - inizio < maxMs) {
    if (c.inCaricamento()) fermoDa = Date.now()
    else if (Date.now() - fermoDa >= 600) break
    await attesa(100)
  }
  // Un giro in piu' per il disegno delle tabelle.
  await attesa(300)
}
