import { useCallback, useEffect, useRef, useState } from 'react'
import { cercaLuoghi, risolviLuogo, testoLuogo, ultimoErroreGoogle, type Luogo } from '../../../utils/luoghiDR7'

interface Props {
    value: string
    onChange: (v: string) => void
    /** Chiamato quando si sceglie un luogo dalla tendina: porta anche le coordinate. */
    onSelect: (l: Luogo) => void
    label?: string
    placeholder?: string
    disabled?: boolean
}

/**
 * Campo di ricerca luogo in stile "app di consegne": si scrive il nome di
 * un'attivita' (DR7, un hotel, l'aeroporto) e la tendina mostra il posto —
 * nome in grande, indirizzo sotto, categoria a lato — non solo la via.
 *
 * Le sedi DR7 arrivano dalla rubrica interna e stanno sempre in cima
 * (OpenStreetMap non ci conosce). Il resto arriva da Photon, con Nominatim
 * come ripiego: vedi `utils/luoghiDR7.ts`.
 */
export default function RicercaLuogo({ value, onChange, onSelect, label, placeholder, disabled }: Props) {
    const [risultati, setRisultati] = useState<Luogo[]>([])
    const [aperto, setAperto] = useState(false)
    const [evidenziato, setEvidenziato] = useState(-1)
    const [stato, setStato] = useState<'fermo' | 'cerca' | 'vuoto'>('fermo')
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const contenitoreRef = useRef<HTMLDivElement>(null)
    // Dopo una scelta il campo cambia testo: non deve ripartire una ricerca.
    const saltaRicercaRef = useRef(false)
    // Solo l'ultima richiesta scritta a video: le risposte lente non
    // sovrascrivono una ricerca piu' recente.
    const richiestaRef = useRef(0)
    /**
     * La sessione di ricerca Google: tutte le battute piu' la scelta finale
     * fanno UNA sessione, e dentro una sessione i suggerimenti non si pagano
     * (si paga solo il dettaglio del posto scelto). Se ne apre una nuova dopo
     * ogni scelta. Senza questo, ogni battuta sarebbe una ricerca fatturata.
     */
    const sessioneRef = useRef<string>(crypto.randomUUID())
    // Il dettaglio del posto scelto e' una chiamata di rete: il campo lo dice.
    const [risolvo, setRisolvo] = useState(false)
    // Quando Google rifiuta si cerca lo stesso (Photon), ma il motivo va
    // scritto: un errore muto fa perdere piu' tempo di un errore visibile.
    const [avvisoGoogle, setAvvisoGoogle] = useState<string | null>(null)

    const cerca = useCallback(async (q: string) => {
        if (q.trim().length < 2) {
            setRisultati([])
            setStato('fermo')
            setAperto(false)
            return
        }
        const mia = ++richiestaRef.current
        setStato('cerca')
        setAperto(true)
        const trovati = await cercaLuoghi(q, 8, sessioneRef.current)
        if (mia !== richiestaRef.current) return
        setRisultati(trovati)
        setStato(trovati.length === 0 ? 'vuoto' : 'fermo')
        setEvidenziato(-1)
        setAvvisoGoogle(ultimoErroreGoogle())
    }, [])

    useEffect(() => {
        if (saltaRicercaRef.current) {
            saltaRicercaRef.current = false
            return
        }
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => void cerca(value), 300)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [value, cerca])

    // Clic fuori: si chiude la tendina.
    useEffect(() => {
        function fuori(e: MouseEvent) {
            if (contenitoreRef.current && !contenitoreRef.current.contains(e.target as Node)) setAperto(false)
        }
        document.addEventListener('mousedown', fuori)
        return () => document.removeEventListener('mousedown', fuori)
    }, [])

    async function scegli(l: Luogo) {
        saltaRicercaRef.current = true
        onChange(testoLuogo(l))
        setAperto(false)
        setRisultati([])
        // I suggerimenti Google non portano le coordinate: si chiedono qui,
        // una volta sola, sul posto davvero scelto.
        if (Number.isFinite(l.lat) && Number.isFinite(l.lon)) {
            onSelect(l)
        } else {
            setRisolvo(true)
            const completo = await risolviLuogo(l, sessioneRef.current)
            setRisolvo(false)
            if (completo) onSelect(completo)
        }
        // Scelta fatta: la sessione si chiude, la prossima ricerca ne apre una nuova.
        sessioneRef.current = crypto.randomUUID()
    }

    function tasti(e: React.KeyboardEvent<HTMLInputElement>) {
        if (!aperto || risultati.length === 0) return
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setEvidenziato(i => (i + 1) % risultati.length)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setEvidenziato(i => (i <= 0 ? risultati.length - 1 : i - 1))
        } else if (e.key === 'Enter' && evidenziato >= 0) {
            e.preventDefault()
            void scegli(risultati[evidenziato])
        } else if (e.key === 'Escape') {
            setAperto(false)
        }
    }

    return (
        <div ref={contenitoreRef} className="relative">
            {label && (
                <label className="block text-sm font-medium text-theme-text-primary mb-2">{label}</label>
            )}
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => { if (risultati.length > 0) setAperto(true) }}
                onKeyDown={tasti}
                placeholder={placeholder || 'Nome del posto o indirizzo'}
                disabled={disabled || risolvo}
                autoComplete="off"
                className="w-full px-3 py-2 min-h-[44px] bg-theme-bg-primary border border-dr7-gold/30 rounded text-base sm:text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors disabled:opacity-50"
            />

            {avvisoGoogle && (
                <div className="mt-1 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                    Google non risponde ({avvisoGoogle}). Risultati dalla ricerca di riserva.
                </div>
            )}

            {aperto && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl overflow-hidden max-h-80 overflow-y-auto">
                    {stato === 'cerca' && risultati.length === 0 && (
                        <div className="px-3 py-3 text-sm text-theme-text-muted">Cerco…</div>
                    )}
                    {stato === 'vuoto' && (
                        <div className="px-3 py-3 text-sm text-theme-text-muted">
                            Nessun posto trovato. Prova col nome del comune o con la via.
                        </div>
                    )}
                    {risultati.map((l, i) => (
                        <button
                            key={l.id}
                            type="button"
                            onMouseEnter={() => setEvidenziato(i)}
                            onClick={() => void scegli(l)}
                            className={`w-full text-left px-3 py-2.5 flex items-start gap-3 border-b border-theme-border last:border-b-0 transition-colors ${
                                i === evidenziato ? 'bg-theme-bg-hover' : 'hover:bg-theme-bg-hover'
                            }`}
                        >
                            <span className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                l.dr7 ? 'bg-dr7-gold/15' : 'bg-theme-bg-tertiary'
                            }`}>
                                <svg className={`w-4 h-4 ${l.dr7 ? 'text-dr7-gold' : 'text-theme-text-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-theme-text-primary truncate">{l.nome}</span>
                                    {l.dr7 && (
                                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-dr7-gold/15 text-dr7-gold shrink-0">
                                            DR7
                                        </span>
                                    )}
                                    {!l.dr7 && l.categoria && (
                                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-muted shrink-0">
                                            {l.categoria}
                                        </span>
                                    )}
                                </span>
                                {l.indirizzo && (
                                    <span className="block text-xs text-theme-text-muted truncate mt-0.5">{l.indirizzo}</span>
                                )}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
