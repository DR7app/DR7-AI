/**
 * NumeroTelefono — un numero con la bandiera del suo paese davanti.
 *
 * Serve a capire a colpo d'occhio, in Clienti e in ogni scheda, se il
 * contatto e' italiano o estero: cambia come lo si chiama e con che tariffa,
 * e su un numero estero un errore di prefisso non si vede leggendo le cifre.
 *
 * Il numero viene mostrato COM'E' salvato: nessuna riformattazione, cosi'
 * quello che si legge e' quello che parte davvero a Green API o al centralino.
 * La bandiera si ricava con la stessa lettura del prefisso usata dal resto del
 * gestionale (utils/prefissiPaesi), quindi un numero senza prefisso resta
 * italiano come gia' assume tutto il resto.
 */
import { bandieraNumero, paeseDaNumero } from '../utils/prefissiPaesi'

interface Props {
    valore: string | null | undefined
    /** Testo quando il numero manca. Default "-", come le altre celle. */
    vuoto?: string
    /** Classi sul contenitore, per non cambiare la tipografia di chi lo usa. */
    className?: string
    /** Rende il numero cliccabile (tel:). Utile nelle schede, non nelle tabelle. */
    link?: boolean
}

export default function NumeroTelefono({ valore, vuoto = '-', className = '', link = false }: Props) {
    const numero = (valore || '').trim()
    if (!numero) return <span className={className}>{vuoto}</span>

    const flag = bandieraNumero(numero)
    const paese = paeseDaNumero(numero)
    // La bandiera e' decorativa: il paese va anche nel title, altrimenti chi
    // usa uno screen reader (o un font senza emoji) non ha l'informazione.
    const testo = link
        ? <a href={`tel:${numero.replace(/[^\d+]/g, '')}`} className="hover:underline">{numero}</a>
        : numero

    // max-w-full/min-w-0 + truncate interno: diversi chiamanti stanno dentro
    // una cella con `truncate`, e un inline-flex senza questi perde i puntini
    // di sospensione e allarga la colonna.
    return (
        <span className={`inline-flex items-center gap-1.5 max-w-full min-w-0 align-bottom ${className}`}>
            {flag && <span aria-hidden="true" title={paese?.nome || undefined} className="shrink-0">{flag}</span>}
            <span className="truncate">{testo}</span>
        </span>
    )
}
