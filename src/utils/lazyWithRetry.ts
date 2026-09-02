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

      // All retries exhausted — try ONE hard refresh
      if (isChunkError && !sessionStorage.getItem(REFRESH_KEY)) {
        console.warn('[lazyWithRetry] All retries failed. Performing hard refresh...')
        sessionStorage.setItem(REFRESH_KEY, '1')
        window.location.reload()
        // Return a never-resolving promise while the page reloads
        return new Promise(() => {})
      }

      // Already refreshed once, or not a chunk error — propagate
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
