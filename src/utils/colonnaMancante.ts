// 01/10/2026: riconosce l'errore "colonna inesistente" di PostgREST/Postgres.
// Serve a chi legge una colonna che potrebbe non essere ancora migrata
// (es. customers_extended.status_cliente) per rileggere senza invece di
// perdere tutta la lettura.
export function isColonnaMancante(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { code, message } = err as { code?: string; message?: string }
  // PGRST204: colonna assente nello schema cache. 42703: colonna inesistente.
  return code === 'PGRST204' || code === '42703' ||
    /column .* does not exist|could not find the .* column/i.test(String(message || ''))
}
