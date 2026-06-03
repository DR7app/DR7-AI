import { useCallback, useRef, useState } from 'react'

/**
 * Run an async action at most once at a time. Rapid repeated clicks
 * (double/triple-click before React re-renders) are ignored until the
 * in-flight call settles.
 *
 * WHY A REF, NOT JUST STATE: a `useState` guard alone is racy — state updates
 * are async, so the second click runs with the same render's closure where the
 * "sending" flag is still false and slips through. The ref flips
 * synchronously, so the very next click is blocked immediately.
 *
 * Returns `[run, pending]`. Wire `pending` to the button's `disabled` for
 * visual feedback; `run` is safe to pass straight to onClick.
 *
 *   const [sendAutoPronta, sending] = useSingleFlight(handleAutoPronta)
 *   <button disabled={sending} onClick={() => sendAutoPronta()}>…</button>
 */
export function useSingleFlight<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown> | unknown,
): [(...args: A) => Promise<void>, boolean] {
  const lock = useRef(false)
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async (...args: A) => {
      if (lock.current) return
      lock.current = true
      setPending(true)
      try {
        await fn(...args)
      } finally {
        lock.current = false
        setPending(false)
      }
    },
    [fn],
  )

  return [run, pending]
}
