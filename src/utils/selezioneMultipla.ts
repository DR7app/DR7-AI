import { useCallback, useState } from 'react'

/**
 * Selezione multipla: lo stato condiviso da ogni elenco del gestionale.
 * I pulsanti e la casella stanno in `components/SelezioneMultipla.tsx`.
 *
 * 02/09/2026 — richiesta di Ophelie: «j'ai besoin du bouton seleziona
 * multipla partout, par exemple dans contratti, pour supprimer plusieurs».
 * Ogni tab aveva (quando l'aveva) il suo pezzo di stato copiato a mano:
 * Fatture il suo, Cargos il suo. Qui c'e' UNA volta sola il comportamento,
 * cosi' ogni elenco lo accende con tre righe e si comporta come gli altri.
 *
 * Regole che valgono ovunque:
 * - finche' la selezione e' spenta l'elenco e' identico a prima: nessuna
 *   casella, nessuna colonna in piu';
 * - spegnere la selezione svuota anche le scelte fatte, cosi' un'azione di
 *   massa non parte mai su righe scelte in un'altra pagina;
 * - "Seleziona tutti" lavora sulle righe A SCHERMO (la pagina corrente), che
 *   sono le uniche che chi guarda ha davvero visto.
 */
export function useSelezioneMultipla() {
  const [attiva, setAttiva] = useState(false)
  const [selezionati, setSelezionati] = useState<string[]>([])

  const alterna = useCallback((id: string) => {
    setSelezionati(prima => prima.includes(id) ? prima.filter(x => x !== id) : [...prima, id])
  }, [])

  const azzera = useCallback(() => setSelezionati([]), [])

  // Accende e spegne. Spegnendo si buttano via le scelte: sono legate alle
  // righe che si stavano guardando.
  const accendiSpegni = useCallback(() => {
    setAttiva(prima => !prima)
    setSelezionati([])
  }, [])

  // Tutte le righe della pagina, oppure nessuna se c'erano gia' tutte.
  const tutte = useCallback((ids: string[]) => {
    setSelezionati(prima => ids.every(id => prima.includes(id)) ? [] : ids)
  }, [])

  const scelto = useCallback((id: string) => selezionati.includes(id), [selezionati])

  return { attiva, selezionati, alterna, azzera, accendiSpegni, tutte, scelto }
}

export type SelezioneMultipla = ReturnType<typeof useSelezioneMultipla>

