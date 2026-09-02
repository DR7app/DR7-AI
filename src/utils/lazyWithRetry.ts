/**
 * lazyWithRetry.ts
 *
 * Wraps React.lazy() with automatic retry and hard-refresh logic
 * to handle chunk load failures after deploy (stale HTML → missing chunks).
 *
 * When a dynamic import fails (chunk not found, MIME error, network error),
 * this utility:
 *   1. Retries the import up to 2 times with a short delay
 *   2. If all retries fail, performs ONE hard refresh (clears cache)
 *   3. If already refreshed, shows a clear error to the user
 *
 * This eliminates the opaque "text/html is not a valid JavaScript MIME type"
 * error for end users.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const REFRESH_KEY = 'chunk_load_refresh'
// Quante ricariche automatiche si concedono, e dopo quanto il conto riparte.
const RICARICHE_MAX = 3
const CONTO_SCADE_MS = 10 * 60 * 1000

/**
 * Si puo' ricaricare la pagina? (02/09/2026)
 *
 * Prima era un si'/no: una sola ricarica per sessione. Bastavano DUE
 * pubblicazioni di seguito mentre la scheda era aperta -- e succede, quando
 * si lavora sul gestionale -- perche' la seconda trovasse il segno gia'
 * messo dalla prima: niente ricarica, l'import falliva e la tab restava
 * vuota. Ophelie, 02/09/2026: «ca ne charge plus rien du tout».
 *
 * Ora si contano: fino a `RICARICHE_MAX`, e il conto riparte da zero dopo
 * `CONTO_SCADE_MS` (o al primo import riuscito). Il tetto resta perche' se
 * il chunk manca davvero la pagina non deve ricaricarsi all'infinito.
 */
export function decidiRicarica(
  grezzo: string | null,
  adesso: number = Date.now()
): { ricarica: boolean; nuovoValore: string } {
  let n = 0
  let quando = 0
  if (grezzo) {
    let letto: unknown = null
    try { letto = JSON.parse(grezzo) } catch { letto = null }
    if (letto && typeof letto === 'object') {
      const o = letto as { n?: unknown; t?: unknown }
      n = Number(o.n) || 0
      quando = Number(o.t) || 0
    } else {
      // Il vecchio formato era la stringa '1' (che JSON legge come numero):
      // vale come una ricarica gia' fatta.
      n = 1
      quando = adesso
    }
  }
  // Passato abbastanza tempo, e' un'altra storia: si riparte da zero.
  if (quando && adesso - quando > CONTO_SCADE_MS) n = 0
  const ricarica = n < RICARICHE_MAX
  return { ricarica, nuovoValore: JSON.stringify({ n: n + 1, t: adesso }) }
}

/** Componente pigro che sa anche scaricarsi in anticipo. */
export type LazyPrecaricabile<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  /** Scarica subito il chunk senza disegnare niente. Non lancia mai. */
  preload: () => void
}

/**
 * Wraps a dynamic import with retry logic.
 * Usage: `const MyComponent = lazyWithRetry(() => import('./MyComponent'))`
 *
 * 02/09/2026 — `preload()`: il gestionale lo chiama quando il mouse passa
 * sopra la voce di menu, cosi' al clic il chunk e' gia' in memoria e non
 * compare nessun segnaposto di attesa.
 */
export default function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  retries = 2,
  retryDelay = 1000
): LazyPrecaricabile<T> {
  let inCorso: Promise<{ default: T }> | null = null
  const carica = () => {
    if (!inCorso) {
      inCorso = retryImport(importFn, retries, retryDelay)
      // Un import fallito non deve restare inchiodato: al render successivo
      // React deve poter riprovare da capo.
      inCorso.catch(() => { inCorso = null })
    }
    return inCorso
  }
  const componente = lazy(carica) as LazyPrecaricabile<T>
  componente.preload = () => { carica().catch(() => {}) }
  return componente
}

async function retryImport<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  retries: number,
  retryDelay: number
): Promise<{ default: T }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const module = await importFn()
      // Success — clear any refresh flag
      if (sessionStorage.getItem(REFRESH_KEY)) {
        sessionStorage.removeItem(REFRESH_KEY)
      }
      return module
    } catch (error) {
      const isChunkError = isChunkLoadError(error)

      console.warn(
        `[lazyWithRetry] Import failed (attempt ${attempt + 1}/${retries + 1}):`,
        isChunkError ? 'Chunk load error' : 'Unknown error',
        error instanceof Error ? error.message : error
      )

      if (attempt < retries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }

      // Finiti i tentativi: si ricarica la pagina, se il conto lo permette.
      if (isChunkError) {
        const { ricarica, nuovoValore } = decidiRicarica(sessionStorage.getItem(REFRESH_KEY))
        if (ricarica) {
          console.warn('[lazyWithRetry] All retries failed. Performing hard refresh...')
          sessionStorage.setItem(REFRESH_KEY, nuovoValore)
          window.location.reload()
          // Return a never-resolving promise while the page reloads
          return new Promise(() => {})
        }
      }

      // Troppe ricariche di fila, o non e' un errore di chunk — si propaga
      throw error
    }
  }

  // TypeScript: unreachable, but satisfies return type
  throw new Error('Import failed after all retries')
}

/**
 * Detects if an error is related to chunk/module loading failures.
 */
function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('mime type') ||
    msg.includes('text/html') ||
    msg.includes('importing a module script') ||
    msg.includes('failed to load module') ||
    msg.includes('unexpected token') // HTML parsed as JS
  )
}
