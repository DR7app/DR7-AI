/**
 * Cache in memoria per le letture di apertura tab.
 *
 * Il gestionale smonta il componente a ogni cambio tab: tornare su Noleggio
 * riscaricava da capo prenotazioni, contratti e clienti, anche a dieci secondi
 * di distanza. Qui le risposte restano in memoria per una finestra breve, e
 * due schermi che chiedono la stessa cosa nello stesso momento condividono UNA
 * sola richiesta invece di farne due.
 *
 * NON tocca i dati: conserva esattamente la risposta ricevuta, tutte le righe.
 * Dopo ogni salvataggio la tab ricarica con `bypass: true`, quindi il numero a
 * video e' sempre quello appena scritto.
 *
 * La cache vive solo per la sessione della pagina: un refresh la azzera.
 */

type Entry = {
  at: number
  value: unknown
  inflight?: Promise<unknown>
}

const store = new Map<string, Entry>()

/** Finestra di default: oltre questa la risposta viene riletta dal database. */
export const DEFAULT_MAX_AGE_MS = 60_000

export interface LoadCachedOptions {
  /** Eta' massima accettata per una risposta gia' in cache. */
  maxAgeMs?: number
  /** true = ignora la cache e rilegge (usato dopo ogni salvataggio). */
  bypass?: boolean
}

export async function loadCached<T>(
  key: string,
  loader: () => PromiseLike<T>,
  options: LoadCachedOptions = {}
): Promise<T> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const existing = store.get(key)

  if (!options.bypass && existing) {
    // Richiesta identica gia' in volo: ci si attacca a quella.
    if (existing.inflight) return existing.inflight as Promise<T>
    if (Date.now() - existing.at < maxAgeMs) return existing.value as T
  }

  const inflight = (async () => {
    const value = await loader()
    store.set(key, { at: Date.now(), value })
    return value
  })()

  store.set(key, { at: existing?.at ?? 0, value: existing?.value, inflight })

  try {
    return (await inflight) as T
  } catch (err) {
    // Una lettura fallita non deve lasciare in cache una promessa morta.
    const current = store.get(key)
    if (current?.inflight === inflight) {
      if (current.value === undefined) store.delete(key)
      else store.set(key, { at: current.at, value: current.value })
    }
    throw err
  }
}

/** Svuota la cache: tutto, oppure le sole chiavi che iniziano per `prefix`. */
export function invalidateCache(prefix?: string): void {
  if (!prefix) { store.clear(); return }
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
