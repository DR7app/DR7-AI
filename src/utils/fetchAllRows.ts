/**
 * Paginazione PARALLELA per PostgREST.
 *
 * PostgREST taglia ogni risposta a 1000 righe, quindi per leggere una tabella
 * intera servono piu' richieste. Il pattern storico le faceva IN SERIE
 * (pagina 1 -> attendi -> pagina 2 -> attendi...): con 2500 prenotazioni sono
 * 3 andate e ritorni sommati, ~2,6 s solo per i bookings.
 *
 * Qui le pagine partono A GRUPPI in parallelo: si legge la prima, e se e'
 * piena si chiedono le successive `burst` tutte insieme. Stesse righe, stesse
 * colonne, stesso ordine - cambia solo che il tempo totale diventa il MASSIMO
 * delle richieste invece della SOMMA.
 *
 * NON filtra e NON tronca nulla: il risultato e' identico alla versione seriale.
 */

export type PageResult<T> = { data: T[] | null; error: unknown }

export interface FetchAllRowsOptions {
  /** Righe per pagina. 1000 e' il massimo di PostgREST. */
  pageSize?: number
  /** Quante pagine chiedere in parallelo per ogni giro. */
  burst?: number
  /**
   * Se le righe hanno un `id`, elimina i duplicati che possono comparire se
   * qualcuno inserisce una riga MENTRE stiamo paginando (la stessa riga
   * scivolerebbe in due pagine diverse). Non elimina mai righe distinte.
   */
  dedupeById?: boolean
}

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: FetchAllRowsOptions = {}
): Promise<{ data: T[]; error: unknown | null }> {
  const pageSize = options.pageSize ?? 1000
  const burst = Math.max(1, options.burst ?? 4)
  const dedupeById = options.dedupeById ?? true

  const pages: T[][] = []
  let error: unknown | null = null
  let nextPage = 0
  let done = false

  // Primo giro da sola: se la tabella sta in una pagina evitiamo richieste inutili.
  {
    const res = await page(0, pageSize - 1)
    if (res.error) return { data: [], error: res.error }
    const rows = res.data || []
    pages[0] = rows
    nextPage = 1
    if (rows.length < pageSize) done = true
  }

  while (!done) {
    const batch: number[] = []
    for (let i = 0; i < burst; i++) batch.push(nextPage + i)
    nextPage += burst

    const results = await Promise.all(
      batch.map(p => page(p * pageSize, p * pageSize + pageSize - 1))
    )

    for (let i = 0; i < results.length; i++) {
      const res = results[i]
      if (res.error) { error = res.error; done = true; break }
      const rows = res.data || []
      pages[batch[i]] = rows
      // Una pagina non piena e' l'ultima: le pagine successive di questo
      // giro sono gia' partite ma torneranno vuote, e le ignoriamo.
      if (rows.length < pageSize) done = true
    }
  }

  const flat: T[] = []
  for (const p of pages) if (p) flat.push(...p)

  if (!dedupeById) return { data: flat, error }

  const seen = new Set<unknown>()
  const unique: T[] = []
  for (const row of flat) {
    const id = (row as { id?: unknown })?.id
    if (id === undefined || id === null) { unique.push(row); continue }
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(row)
  }
  return { data: unique, error }
}
