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
import { lazy, type ComponentType } from 'react'

const REFRESH_KEY = 'chunk_load_refresh'

/**
 * Wraps a dynamic import with retry logic.
 * Usage: `const MyComponent = lazyWithRetry(() => import('./MyComponent'))`
 */
export default function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  retries = 2,
  retryDelay = 1000
) {
  return lazy(() => retryImport(importFn, retries, retryDelay))
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
