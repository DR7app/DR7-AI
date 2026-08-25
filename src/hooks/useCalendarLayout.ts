/**
 * Layout persistente del Calendario Noleggio (larghezze colonne + altezze righe).
 *
 * Il calendario calcola di default TUTTO in automatico (cellWidth = area / giorni,
 * rowHeight = area / veicoli) per stare a schermo senza scroll. Questo hook
 * introduce degli OVERRIDE MANUALI: quando un valore e' presente vince sul
 * calcolo automatico, quando e' assente si torna all'automatico.
 *
 * Persistenza CONDIVISA in `app_settings` (stessa tabella di
 * carwash_hidden_plates / birthday settings): il layout e' uno solo per tutti
 * gli operatori — se lo cambia uno, lo vedono tutti.
 *
 * 2026-08-25 (direzione): niente piu' OTP per cambiare le dimensioni. Era un
 * passaggio in piu' per un'operazione che si annulla con "Reset auto", e
 * bloccava una cosa che serve tutti i giorni.
 *
 * 2026-08-25: UN LAYOUT PER CALENDARIO. La chiave era una sola, quindi le
 * larghezze scelte su Terra si applicavano anche a Mare, Aria e Soggiorni —
 * che hanno un numero di mezzi e nomi diversi, quindi misure diverse. Ogni
 * business tiene le sue: `calendar_noleggio_layout` (Terra, chiave storica
 * lasciata com'e' per non perdere le misure gia' salvate) e
 * `calendar_noleggio_layout__<service_type>` per gli altri.
 *
 * `app_settings.value` e' TEXT → serializziamo in JSON come fanno gli altri
 * consumatori della tabella.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

/** Chiave in app_settings, una per calendario. */
const SETTINGS_KEY_BASE = 'calendar_noleggio_layout'
function settingsKey(serviceType?: string): string {
  // Terra (nessun serviceType, o 'car_rental') resta sulla chiave storica.
  if (!serviceType || serviceType === 'car_rental' || serviceType === 'rental') return SETTINGS_KEY_BASE
  return `${SETTINGS_KEY_BASE}__${serviceType}`
}

/** Limiti di sicurezza: un drag non puo' rendere il calendario inusabile. */
export const LAYOUT_LIMITS = {
  leftColW: { min: 120, max: 600, auto: 300 },
  cellW: { min: 20, max: 200 },
  rowH: { min: 24, max: 300 },
} as const

export interface CalendarLayout {
  /** Larghezza colonna "Veicolo / Targa". undefined = automatica (300px). */
  leftColW?: number
  /** Larghezza di TUTTE le colonne giorno. undefined = automatica (fit a schermo). */
  cellW?: number
  /** Altezza per singolo veicolo (chiave = vehicle.id). Assente = automatica. */
  rowH?: Record<string, number>
}

const EMPTY: CalendarLayout = {}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)))
}

export function useCalendarLayout(serviceType?: string) {
  const SETTINGS_KEY = settingsKey(serviceType)
  const [layout, setLayout] = useState<CalendarLayout>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  // Ultimo layout scritto: serve al salvataggio differito (persist a fine drag)
  // per non dipendere dallo state async dentro i pointer handler.
  const latestRef = useRef<CalendarLayout>(EMPTY)

  useEffect(() => {
    let cancelled = false
    latestRef.current = EMPTY
    setLayout(EMPTY)
    setLoaded(false)
    ;(async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', SETTINGS_KEY)
        .maybeSingle()
      if (cancelled) return
      if (data?.value) {
        try {
          const parsed = JSON.parse(data.value)
          if (parsed && typeof parsed === 'object') {
            const next: CalendarLayout = {}
            if (typeof parsed.leftColW === 'number') {
              next.leftColW = clamp(parsed.leftColW, LAYOUT_LIMITS.leftColW.min, LAYOUT_LIMITS.leftColW.max)
            }
            if (typeof parsed.cellW === 'number') {
              next.cellW = clamp(parsed.cellW, LAYOUT_LIMITS.cellW.min, LAYOUT_LIMITS.cellW.max)
            }
            if (parsed.rowH && typeof parsed.rowH === 'object') {
              const rows: Record<string, number> = {}
              for (const [k, v] of Object.entries(parsed.rowH)) {
                if (typeof v === 'number') rows[k] = clamp(v, LAYOUT_LIMITS.rowH.min, LAYOUT_LIMITS.rowH.max)
              }
              if (Object.keys(rows).length) next.rowH = rows
            }
            latestRef.current = next
            setLayout(next)
          }
        } catch { /* valore non valido — resta automatico */ }
      }
      setLoaded(true)
    })()
    return () => { cancelled = true }
    // Cambiando business (Mare -> Aria) si rileggono le misure di QUEL
    // calendario, invece di tenere quelle del precedente.
  }, [SETTINGS_KEY])

  /** Aggiorna in locale (durante il drag). NON scrive su DB. */
  const applyLocal = useCallback((patch: (prev: CalendarLayout) => CalendarLayout) => {
    setLayout(prev => {
      const next = patch(prev)
      latestRef.current = next
      return next
    })
  }, [])

  /** Scrive su DB il layout corrente. Da chiamare a fine drag (pointerup). */
  const persist = useCallback(async () => {
    setSaving(true)
    try {
      const { error } = await supabase.from('app_settings').upsert(
        {
          key: SETTINGS_KEY,
          value: JSON.stringify(latestRef.current),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      )
      if (error) throw error
      return true
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }, [SETTINGS_KEY])

  const setLeftColW = useCallback((px: number) => {
    applyLocal(prev => ({ ...prev, leftColW: clamp(px, LAYOUT_LIMITS.leftColW.min, LAYOUT_LIMITS.leftColW.max) }))
  }, [applyLocal])

  const setCellW = useCallback((px: number) => {
    applyLocal(prev => ({ ...prev, cellW: clamp(px, LAYOUT_LIMITS.cellW.min, LAYOUT_LIMITS.cellW.max) }))
  }, [applyLocal])

  const setRowH = useCallback((vehicleId: string, px: number) => {
    applyLocal(prev => ({
      ...prev,
      rowH: { ...(prev.rowH || {}), [vehicleId]: clamp(px, LAYOUT_LIMITS.rowH.min, LAYOUT_LIMITS.rowH.max) },
    }))
  }, [applyLocal])

  /** Torna al layout completamente automatico (svuota la riga in app_settings). */
  const resetAll = useCallback(async () => {
    latestRef.current = EMPTY
    setLayout(EMPTY)
    return persist()
  }, [persist])

  /** true se almeno un valore manuale e' attivo (per mostrare "Reset auto"). */
  const hasManualLayout =
    layout.leftColW !== undefined ||
    layout.cellW !== undefined ||
    Object.keys(layout.rowH || {}).length > 0

  return { layout, loaded, saving, hasManualLayout, setLeftColW, setCellW, setRowH, persist, resetAll }
}
