/**
 * Paginazione PARALLELA lato server, gemella di `src/utils/fetchAllRows.ts`.
 *
 * PostgREST taglia OGNI risposta a 1000 righe, in silenzio: una funzione che
 * legge una tabella piu' grande senza `.range()` restituisce un elenco
 * incompleto e nessuno se ne accorge, perche' non c'e' nessun errore. E' cosi'
 * che il tab Nexi mostrava 1.000 transazioni su 6.349.
 *
 * Qui la prima pagina viene chiesta con `count: 'exact'`, quindi si sa subito
 * quante pagine mancano e partono tutte INSIEME: il tempo totale e' il MASSIMO
 * delle richieste, non la loro somma.
 *
 * NON filtra e NON tronca nulla: il risultato e' l'elenco completo.
 */

export type PaginaRisultato<T> = { data: T[] | null; error: unknown; count?: number | null }

export interface LeggiTutteLeRigheOpzioni {
  /** Righe per pagina. 1000 e' il massimo di PostgREST. */
  pageSize?: number
  /**
   * Se le righe hanno un `id`, toglie i doppioni che possono comparire se
   * qualcuno scrive MENTRE stiamo paginando (la stessa riga scivolerebbe in
   * due pagine). Non toglie mai righe distinte.
   */
  dedupeById?: boolean
}

/**
 * `pagina(from, to, conConteggio)` deve costruire la query OGNI VOLTA da capo:
 * un builder di supabase-js non si puo' riusare dopo che e' partito.
 */
export async function leggiTutteLeRighe<T>(
  pagina: (from: number, to: number, conConteggio: boolean) => PromiseLike<PaginaRisultato<T>>,
  opzioni: LeggiTutteLeRigheOpzioni = {}
): Promise<{ data: T[]; error: unknown | null }> {
  const pageSize = opzioni.pageSize ?? 1000
  const dedupeById = opzioni.dedupeById ?? true

  const prima = await pagina(0, pageSize - 1, true)
  if (prima.error) return { data: [], error: prima.error }

  const righe: T[] = [...(prima.data || [])]
  const totale = prima.count ?? righe.length

  if (totale > pageSize) {
    const inizi: number[] = []
    for (let start = pageSize; start < totale; start += pageSize) inizi.push(start)

    const resto = await Promise.all(
      inizi.map(start => pagina(start, start + pageSize - 1, false))
    )
    for (const p of resto) {
      if (p.error) return { data: righe, error: p.error }
      righe.push(...(p.data || []))
    }
  }

  if (!dedupeById) return { data: righe, error: null }

  const visti = new Set<unknown>()
  const uniche: T[] = []
  for (const r of righe) {
    const id = (r as { id?: unknown })?.id
    if (id === undefined || id === null) { uniche.push(r); continue }
    if (visti.has(id)) continue
    visti.add(id)
    uniche.push(r)
  }
  return { data: uniche, error: null }
}
