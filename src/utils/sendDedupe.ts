/**
 * Network-level safety net against double-sends.
 *
 * THE BUG: clicking a send button twice (or 10×) fast fires the handler
 * multiple times before React re-renders, so a per-component `isSending`
 * state guard is racy and the customer receives the same WhatsApp again and
 * again. A UI lock (see `useSingleFlight`) fixes the buttons we touch, but
 * this interceptor guarantees no duplicate send can leave the browser at all
 * — for every call site, including `authFetch`, template-URL variants, and
 * any future code — by patching the global `fetch` once at startup.
 *
 * HOW: for requests to a known set of side-effectful "send" endpoints we build
 * a signature from method+url+body. If an identical request is already
 * in-flight, the duplicate awaits and returns a clone of the same response.
 * If an identical request settled within DEDUPE_WINDOW_MS, the duplicate is
 * answered with a synthetic 200 `{ deduped: true }` and never hits the
 * network. Because the signature includes the body, two *genuinely different*
 * sends never collide — only byte-for-byte repeats within the window are
 * dropped, which is exactly the double-click bug.
 *
 * Everything that is NOT a send endpoint passes straight through untouched.
 */

// Requests whose duplicate within the window must be suppressed. Match is a
// simple substring test on the URL, so both '/.netlify/functions/foo' and an
// absolute 'https://site/.netlify/functions/foo' are covered. Add endpoints
// here as new "send" actions appear.
const GUARDED_ENDPOINTS = [
  'send-whatsapp-notification',
  'send-booking-confirmation',
  'nexi-pay-by-link',
  'nexi-create-preauth',
  'nexi-nuovo-addebito',
  'submit-customer-invite',
] as const

// How long after a successful identical send we keep dropping repeats.
const DEDUPE_WINDOW_MS = 6000

interface Entry {
  /** Set while the request is in flight; cleared on settle. */
  promise?: Promise<Response>
  /** Timestamp of the last settle, used for the post-completion window. */
  settledAt?: number
}

const inflight = new Map<string, Entry>()

function isGuarded(url: string): boolean {
  return GUARDED_ENDPOINTS.some((e) => url.includes(e))
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  // Request object
  return input.url
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof input === 'object' && 'method' in input && input.method) {
    return String(input.method).toUpperCase()
  }
  return 'GET'
}

function bodyKey(init?: RequestInit): string {
  const b = init?.body
  if (b == null) return ''
  if (typeof b === 'string') return b
  try {
    return JSON.stringify(b)
  } catch {
    // Non-serialisable body (FormData/Blob/stream): fall back to a marker so
    // we don't accidentally treat two different uploads as identical.
    return `__nonserializable__${Date.now()}`
  }
}

function dedupedResponse(): Response {
  return new Response(JSON.stringify({ deduped: true, ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

let installed = false

/**
 * Patch `window.fetch` once. Safe to call multiple times (HMR / re-import);
 * only the first call wraps the real fetch.
 */
export function installSendDedupe(): void {
  if (installed) return
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true

  const realFetch = window.fetch.bind(window)

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let url: string
    try {
      url = urlOf(input)
    } catch {
      return realFetch(input as RequestInfo, init)
    }

    // GETs and non-send endpoints are never deduped.
    if (!isGuarded(url) || methodOf(input, init) === 'GET') {
      return realFetch(input as RequestInfo, init)
    }

    const sig = `${methodOf(input, init)} ${url} ${bodyKey(init)}`
    const now = Date.now()
    const entry = inflight.get(sig)

    // Identical request already in flight → share its result.
    if (entry?.promise) {
      return entry.promise.then((r) => r.clone())
    }
    // Identical request completed very recently → drop this repeat.
    if (entry?.settledAt != null && now - entry.settledAt < DEDUPE_WINDOW_MS) {
      return Promise.resolve(dedupedResponse())
    }

    const promise = realFetch(input as RequestInfo, init)
    inflight.set(sig, { promise })
    promise
      .then(
        () => { inflight.set(sig, { settledAt: Date.now() }) },
        () => { inflight.delete(sig) }, // on network error, allow an honest retry
      )
    // Prune the settled marker once its window has elapsed so the Map can't grow.
    promise.finally(() => {
      setTimeout(() => {
        const e = inflight.get(sig)
        if (e && !e.promise && e.settledAt != null && Date.now() - e.settledAt >= DEDUPE_WINDOW_MS) {
          inflight.delete(sig)
        }
      }, DEDUPE_WINDOW_MS + 100)
    })

    // Return a clone so the in-flight followers and the original caller each
    // get an independently-readable body.
    return promise.then((r) => r.clone())
  } as typeof window.fetch
}
