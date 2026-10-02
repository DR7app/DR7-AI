/**
 * Production-safe logger utility.
 * Only outputs in development mode (import.meta.env.DEV).
 * Errors always log, even in production.
 */

// 02/10/2026: `?.` perche' il motore allarmi gira anche nelle Netlify
// function, dove import.meta.env non esiste e l'accesso diretto esplodeva
// al caricamento del modulo.
const isDev = !!import.meta.env?.DEV

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LogArgs = any[]

export const logger = {
  log(...args: LogArgs) {
    if (isDev) console.log(...args)
  },
  warn(...args: LogArgs) {
    if (isDev) console.warn(...args)
  },
  error(...args: LogArgs) {
    console.error(...args)
  },
  debug(...args: LogArgs) {
    if (isDev) console.log('[DEBUG]', ...args)
  },
}
