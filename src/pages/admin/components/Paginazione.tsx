/**
 * Barra di paginazione condivisa dell'admin.
 *
 * Motivo: le liste lunghe (Prenotazioni in testa, 2600+ righe) venivano
 * disegnate INTERE a ogni apertura di tab. Il browser doveva costruire
 * migliaia di righe tabella PIU' altrettante card mobile (nascoste con
 * `lg:hidden`, ma comunque presenti nel DOM): il cambio tab restava bloccato
 * per secondi anche con i dati gia' in memoria.
 *
 * Qui si disegna una pagina per volta. I dati caricati NON cambiano: filtri,
 * ricerca, statistiche e controlli di disponibilita' continuano a vedere
 * l'elenco completo — cambia solo quante righe finiscono a schermo.
 */

interface PaginazioneProps {
    /** Pagina corrente, 1-based. */
    pagina: number
    /** Righe totali DOPO i filtri (non le righe della pagina). */
    totale: number
    /** Righe per pagina. */
    perPagina: number
    onChange: (pagina: number) => void
    /** Nome plurale dell'elemento, per la scritta "Mostrando X - Y di Z ...". */
    etichetta?: string
}

export default function Paginazione({ pagina, totale, perPagina, onChange, etichetta = 'righe' }: PaginazioneProps) {
    const pagine = Math.max(1, Math.ceil(totale / perPagina))
    // Una sola pagina: la barra non serve e occuperebbe spazio a vuoto.
    if (totale === 0 || pagine <= 1) return null

    const primo = (pagina - 1) * perPagina + 1
    const ultimo = Math.min(pagina * perPagina, totale)

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 lg:px-6 py-3 lg:py-4 border-t border-theme-border">
            <div className="text-sm text-theme-text-muted">
                Mostrando {primo} - {ultimo} di {totale} {etichetta}
            </div>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => onChange(Math.max(1, pagina - 1))}
                    disabled={pagina <= 1}
                    className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-full hover:bg-theme-bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    ← Precedente
                </button>
                <div className="flex items-center gap-2 px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-full whitespace-nowrap">
                    Pagina {pagina} di {pagine}
                </div>
                <button
                    type="button"
                    onClick={() => onChange(Math.min(pagine, pagina + 1))}
                    disabled={pagina >= pagine}
                    className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-full hover:bg-theme-bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    Successiva →
                </button>
            </div>
        </div>
    )
}
