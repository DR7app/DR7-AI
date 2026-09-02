/**
 * statoTab.ts — la tab si riapre com'era, senza attese.
 *
 * Il gestionale smonta il componente a ogni cambio schermata: tornare su
 * Clienti o Prenotazioni ricominciava da zero (stato vuoto, `loading = true`,
 * segnaposto a schermo) anche a cinque secondi di distanza.
 *
 * Qui si conserva l'ULTIMO stato gia' elaborato di una tab — non la risposta
 * grezza del server, ma le righe come la tab le disegna. Al rientro il primo
 * disegno parte da quelle: la pagina e' piena subito, e l'aggiornamento vero
 * arriva in sottofondo un attimo dopo.
 *
 * Differenza con `dataCache.ts`: quello evita la CHIAMATA, questo evita
 * l'ATTESA. Si usano insieme.
 *
 * Vive solo per la sessione della pagina: un refresh riparte pulito, e i dati
 * non finiscono mai su disco (l'anagrafica non deve restare nel browser).
 */
import { useCallback, useRef, useState } from 'react'

type Voce = { at: number; valore: unknown }

const memoria = new Map<string, Voce>()

/** Oltre questa eta' lo stato conservato viene ignorato e si rilegge. */
export const ETA_MASSIMA_MS = 5 * 60_000

export function leggiStato<T>(chiave: string, etaMassimaMs = ETA_MASSIMA_MS): T | undefined {
  const v = memoria.get(chiave)
  if (!v) return undefined
  if (Date.now() - v.at >= etaMassimaMs) { memoria.delete(chiave); return undefined }
  return v.valore as T
}

export function scriviStato<T>(chiave: string, valore: T): void {
  memoria.set(chiave, { at: Date.now(), valore })
}

/** Butta via lo stato conservato: tutto, o le sole chiavi che iniziano per `prefisso`. */
export function scordaStato(prefisso?: string): void {
  if (!prefisso) { memoria.clear(); return }
  for (const k of Array.from(memoria.keys())) if (k.startsWith(prefisso)) memoria.delete(k)
}

/**
 * Come `useState`, ma il valore iniziale e' quello che la tab aveva l'ultima
 * volta (se c'e' ed e' recente) e ogni scrittura lo conserva.
 *
 *   const [clienti, setClienti] = useStatoTab<Cliente[]>('clienti:lista', [])
 *   const [loading, setLoading] = useState(clienti.length === 0)
 *
 * La seconda riga e' il punto: con lo stato gia' pieno non si parte piu' da
 * "in attesa", quindi non compare nessun segnaposto.
 */
export function useStatoTab<T>(chiave: string, iniziale: T, etaMassimaMs = ETA_MASSIMA_MS) {
  const chiaveRef = useRef(chiave)
  chiaveRef.current = chiave

  const [valore, setValoreRaw] = useState<T>(() => {
    const salvato = leggiStato<T>(chiave, etaMassimaMs)
    return salvato === undefined ? iniziale : salvato
  })

  const setValore = useCallback((next: T | ((prev: T) => T)) => {
    setValoreRaw(prev => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      scriviStato(chiaveRef.current, v)
      return v
    })
  }, [])

  return [valore, setValore] as const
}

/** Vero se la tab ha gia' qualcosa da mostrare: si parte senza segnaposto. */
export function statoPronto(chiave: string, etaMassimaMs = ETA_MASSIMA_MS): boolean {
  return leggiStato(chiave, etaMassimaMs) !== undefined
}
