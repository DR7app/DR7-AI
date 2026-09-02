/**
 * Scheletro.tsx
 *
 * Segnaposto che prende la forma di quello che sta arrivando.
 *
 * Regola del gestionale: a schermo non deve MAI comparire la scritta
 * "Caricamento...". Chi apre una tab vede subito la pagina — titolo, filtri,
 * intestazioni, righe — e le righe si riempiono da sole appena i dati
 * arrivano. Se la tab era gia' stata aperta di recente i dati sono in cache
 * (`peekCached` in utils/dataCache.ts) e questo scheletro non compare
 * nemmeno: la pagina e' gia' piena al primo disegno.
 *
 * Colori: solo token del tema, cosi' funziona su tutte le palette.
 */

/** Una barra grigia: il mattone di tutti gli scheletri. */
export function ScheletroBarra({ className = 'h-4 w-full' }: { className?: string }) {
    return <div className={`animate-pulse rounded bg-theme-bg-tertiary ${className}`} />
}

/** Righe di testo, larghezze leggermente diverse per non sembrare una griglia. */
export function ScheletroTesto({ righe = 3, className = '' }: { righe?: number; className?: string }) {
    const larghezze = ['w-full', 'w-11/12', 'w-9/12', 'w-10/12', 'w-8/12']
    return (
        <div className={`space-y-2 ${className}`}>
            {Array.from({ length: righe }).map((_, i) => (
                <ScheletroBarra key={i} className={`h-3 ${larghezze[i % larghezze.length]}`} />
            ))}
        </div>
    )
}

/** Blocco pieno: usato al posto di grafici, riquadri e pannelli. */
export function ScheletroRiquadro({ className = 'h-40 w-full' }: { className?: string }) {
    return <ScheletroBarra className={className} />
}

/**
 * Righe da infilare dentro un <tbody> gia' esistente: prende lo stesso numero
 * di colonne della tabella vera, cosi' la larghezza non salta quando arrivano
 * i dati.
 */
export function ScheletroRigheTabella({ righe = 6, colonne = 5 }: { righe?: number; colonne?: number }) {
    return (
        <>
            {Array.from({ length: righe }).map((_, r) => (
                <tr key={r} className="border-b border-theme-border">
                    {Array.from({ length: colonne }).map((_, c) => (
                        <td key={c} className="px-4 py-3">
                            <ScheletroBarra className={`h-3 ${c === 0 ? 'w-32' : 'w-20'}`} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    )
}

/** Tabella intera (intestazione + righe), quando non c'e' una tabella vera da riempire. */
export function ScheletroTabella({ righe = 8, colonne = 5, className = '' }: { righe?: number; colonne?: number; className?: string }) {
    return (
        <div className={`overflow-hidden rounded-lg border border-theme-border ${className}`}>
            <div className="flex gap-4 border-b border-theme-border bg-theme-bg-tertiary/40 px-4 py-3">
                {Array.from({ length: colonne }).map((_, c) => (
                    <ScheletroBarra key={c} className={`h-3 ${c === 0 ? 'w-32' : 'w-20'}`} />
                ))}
            </div>
            {Array.from({ length: righe }).map((_, r) => (
                <div key={r} className="flex gap-4 border-b border-theme-border px-4 py-3 last:border-0">
                    {Array.from({ length: colonne }).map((_, c) => (
                        <ScheletroBarra key={c} className={`h-3 ${c === 0 ? 'w-32' : 'w-20'}`} />
                    ))}
                </div>
            ))}
        </div>
    )
}

/** Elenco di schede (clienti, veicoli, fornitori...). */
export function ScheletroLista({ righe = 6, className = '' }: { righe?: number; className?: string }) {
    return (
        <div className={`space-y-2 ${className}`}>
            {Array.from({ length: righe }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-theme-border p-3">
                    <ScheletroBarra className="h-9 w-9 rounded-full" />
                    <div className="flex-1 space-y-2">
                        <ScheletroBarra className="h-3 w-2/5" />
                        <ScheletroBarra className="h-3 w-1/4" />
                    </div>
                    <ScheletroBarra className="h-3 w-16" />
                </div>
            ))}
        </div>
    )
}

/** Fila di riquadri numerici in cima alle pagine (KPI, totali). */
export function ScheletroCard({ numero = 4, className = '' }: { numero?: number; className?: string }) {
    return (
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
            {Array.from({ length: numero }).map((_, i) => (
                <div key={i} className="rounded-lg border border-theme-border p-4">
                    <ScheletroBarra className="h-3 w-24" />
                    <ScheletroBarra className="mt-3 h-6 w-16" />
                </div>
            ))}
        </div>
    )
}

/**
 * Pagina completa: titolo, riquadri, barra filtri, tabella.
 * E' il segnaposto di default quando una tab non ha ancora niente da mostrare.
 */
export function ScheletroPagina({
    titolo = true,
    card = 0,
    filtri = true,
    righe = 8,
    colonne = 5,
}: { titolo?: boolean; card?: number; filtri?: boolean; righe?: number; colonne?: number }) {
    return (
        <div className="space-y-6">
            {titolo && <ScheletroBarra className="h-7 w-56" />}
            {card > 0 && <ScheletroCard numero={card} />}
            {filtri && (
                <div className="flex flex-wrap gap-3">
                    <ScheletroBarra className="h-9 w-56" />
                    <ScheletroBarra className="h-9 w-36" />
                    <ScheletroBarra className="h-9 w-36" />
                </div>
            )}
            <ScheletroTabella righe={righe} colonne={colonne} />
        </div>
    )
}

export default ScheletroPagina
