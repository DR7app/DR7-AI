/**
 * Categorie di una segnalazione EMTN: menu a tendina con ricerca e scelta
 * multipla.
 *
 * 28/09/2026 (direzione): i pulsanti in griglia non reggevano un elenco piu'
 * lungo. Un solo componente per la scheda "Segnalazione evento" di EMTNTab e
 * per la modale "Segnala Evento", cosi' le due restano uguali.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { EMTN_CATEGORIE } from './emtnCategorie'

/** Minuscolo e senza accenti: "Penalità" si trova scrivendo "penalita". */
function normalizza(testo: string): string {
    return testo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export default function SelettoreCategorieEMTN({
    value,
    onChange,
    accento = 'amber',
}: {
    value: string[]
    onChange: (next: string[]) => void
    /** Colore della scheda che lo ospita: ambra in EMTNTab, oro nella modale. */
    accento?: 'amber' | 'gold'
}) {
    const [aperto, setAperto] = useState(false)
    const [ricerca, setRicerca] = useState('')
    const contenitore = useRef<HTMLDivElement>(null)
    const campoRicerca = useRef<HTMLInputElement>(null)

    const bordoAttivo = accento === 'gold' ? 'border-dr7-gold' : 'border-amber-500'
    const sfondoAttivo = accento === 'gold' ? 'bg-dr7-gold/10' : 'bg-amber-500/10'
    const spunta = accento === 'gold' ? 'accent-[#c9a45c]' : 'accent-amber-500'

    const scelte = useMemo(
        () => value.map(id => EMTN_CATEGORIE.find(c => c.id === id)).filter((c): c is typeof EMTN_CATEGORIE[number] => !!c),
        [value],
    )
    const filtrate = useMemo(() => {
        const q = normalizza(ricerca)
        if (!q) return EMTN_CATEGORIE
        return EMTN_CATEGORIE.filter(c => normalizza(c.label).includes(q) || normalizza(c.helper).includes(q))
    }, [ricerca])

    useEffect(() => {
        if (!aperto) return
        campoRicerca.current?.focus()
        function fuori(e: MouseEvent) {
            if (contenitore.current && !contenitore.current.contains(e.target as Node)) setAperto(false)
        }
        function tasto(e: KeyboardEvent) {
            if (e.key === 'Escape') setAperto(false)
        }
        document.addEventListener('mousedown', fuori)
        document.addEventListener('keydown', tasto)
        return () => {
            document.removeEventListener('mousedown', fuori)
            document.removeEventListener('keydown', tasto)
        }
    }, [aperto])

    function alterna(id: string) {
        onChange(value.includes(id) ? value.filter(k => k !== id) : [...value, id])
    }

    return (
        <div ref={contenitore} className="relative">
            <button
                type="button"
                onClick={() => setAperto(a => !a)}
                aria-haspopup="listbox"
                aria-expanded={aperto}
                className={`w-full min-h-[40px] flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-theme-bg-primary text-left transition-colors ${
                    aperto ? bordoAttivo : 'border-theme-border hover:border-theme-text-muted'
                }`}
            >
                <span className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                    {scelte.length === 0 ? (
                        <span className="text-xs text-theme-text-muted py-0.5">Seleziona una o piu' categorie</span>
                    ) : scelte.map(c => (
                        <span
                            key={c.id}
                            className={`inline-flex items-center gap-1 rounded-md border ${bordoAttivo} ${sfondoAttivo} px-2 py-0.5 text-[11px] font-medium text-theme-text-primary`}
                        >
                            {c.label}
                            <span
                                role="button"
                                tabIndex={0}
                                aria-label={`Togli ${c.label}`}
                                onClick={e => { e.stopPropagation(); alterna(c.id) }}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); alterna(c.id) } }}
                                className="text-theme-text-muted hover:text-red-400 cursor-pointer"
                            >
                                ×
                            </span>
                        </span>
                    ))}
                </span>
                <svg className={`w-4 h-4 shrink-0 text-theme-text-muted transition-transform ${aperto ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                </svg>
            </button>

            {aperto && (
                <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-theme-border">
                        <input
                            ref={campoRicerca}
                            value={ricerca}
                            onChange={e => setRicerca(e.target.value)}
                            placeholder="Cerca categoria..."
                            className="w-full rounded-md border border-theme-border bg-theme-bg-primary px-2.5 py-1.5 text-xs text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none"
                        />
                    </div>
                    <ul role="listbox" aria-multiselectable="true" className="max-h-60 overflow-y-auto py-1">
                        {filtrate.map(c => {
                            const attiva = value.includes(c.id)
                            return (
                                <li key={c.id} role="option" aria-selected={attiva}>
                                    <label className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-theme-bg-hover ${attiva ? sfondoAttivo : ''}`}>
                                        <input
                                            type="checkbox"
                                            checked={attiva}
                                            onChange={() => alterna(c.id)}
                                            className={`mt-0.5 ${spunta}`}
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-xs font-medium text-theme-text-primary">{c.label}</span>
                                            <span className="block text-[11px] text-theme-text-muted">{c.helper}</span>
                                        </span>
                                    </label>
                                </li>
                            )
                        })}
                        {filtrate.length === 0 && (
                            <li className="px-3 py-3 text-xs text-theme-text-muted">Nessuna categoria per "{ricerca}"</li>
                        )}
                    </ul>
                    {value.length > 0 && (
                        <div className="flex items-center justify-between px-3 py-2 border-t border-theme-border">
                            <span className="text-[11px] text-theme-text-muted">{value.length} selezionate</span>
                            <button type="button" onClick={() => onChange([])} className="text-[11px] font-medium text-theme-text-secondary hover:text-red-400">
                                Deseleziona tutte
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
