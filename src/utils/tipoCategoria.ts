/**
 * Tipo di veicolo ricavato dall'ETICHETTA della categoria di Centralina Pro.
 *
 * 20/09/2026 (direzione): gli id delle categorie sono storici e non dicono
 * piu' cosa contengono — `urban` e' etichettato "Hypercar" (M8 800cv, GLE 63,
 * SL55, Macan GTS), `aziendali` e' "Supercar" (RS3, A45S, Cayenne S),
 * `scooter` e' "Urban" (Ypsilon, Yaris). Chi confronta l'id sbaglia mezzo
 * parco macchine; l'etichetta, che la direzione mantiene nella tab Veicoli,
 * e' l'unica cosa che dice davvero cos'e' quel veicolo.
 *
 * Nessun rinomino: Centralina e Veicoli restano come sono. Etichetta non
 * riconosciuta = `null`, e il chiamante resta sul suo comportamento storico.
 *
 * Gemello lato sito: `Sito/utils/tipoCategoria.ts`. Se cambia una regola qui,
 * cambia anche li'.
 */
export type TipoVeicolo = 'UTILITARIA' | 'FURGONE' | 'SUPERCAR'

export function tipoDaEtichetta(label: string): TipoVeicolo | null {
    const l = String(label || '').toLowerCase()
    if (!l) return null
    // Prima i furgoni: "Flotta Aziendale" contiene sia "flotta" sia "aziendal".
    if (l.includes('furgon') || l.includes('flotta') || l.includes('aziendal') || l.includes('van')) return 'FURGONE'
    if (l.includes('urban') || l.includes('utilitar') || l.includes('city')) return 'UTILITARIA'
    if (l.includes('supercar') || l.includes('hypercar') || l.includes('exotic') || l.includes('luxury') || l.includes('suv')) return 'SUPERCAR'
    return null
}
