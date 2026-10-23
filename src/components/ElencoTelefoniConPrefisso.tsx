/**
 * Piu' numeri di telefono, ognuno con la sua bandiera e il suo prefisso.
 *
 * 23/10/2026: i campi "Destinatari (telefoni, separati da virgola)" erano un
 * testo libero: "345 458 2811" senza paese, nessuna bandiera, mentre ovunque
 * il numero si sceglie con TelefonoConPrefisso. Qui ogni numero e' una riga
 * TelefonoConPrefisso; il valore resta lo stesso testo separato da virgole
 * (in forma E.164, "+39345..."), quindi chi lo legge (cron, riepiloghi) non
 * cambia.
 */
import { useEffect, useState } from 'react'
import TelefonoConPrefisso from './TelefonoConPrefisso'

interface Props {
    /** Numeri separati da virgola, punto e virgola o a capo. */
    value: string | null | undefined
    /** Riceve i numeri compilati separati da ", " (stringa vuota se nessuno). */
    onChange: (valore: string) => void
    disabled?: boolean
}

const spezza = (v: string | null | undefined) =>
    String(v || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)

export default function ElencoTelefoniConPrefisso({ value, onChange, disabled = false }: Props) {
    // Le righe vivono in uno stato proprio: una riga appena aggiunta e ancora
    // vuota non e' nel valore salvato e altrimenti sparirebbe subito.
    const [righe, setRighe] = useState<string[]>(() => {
        const r = spezza(value)
        return r.length ? r : ['']
    })
    useEffect(() => {
        const esterni = spezza(value)
        if (esterni.join(',') !== righe.filter(Boolean).join(',')) setRighe(esterni.length ? esterni : [''])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    const aggiorna = (nuove: string[]) => {
        setRighe(nuove)
        onChange(nuove.filter(Boolean).join(', '))
    }

    return (
        <div className="space-y-2">
            {righe.map((n, i) => (
                <div key={i} className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                        <TelefonoConPrefisso
                            value={n}
                            disabled={disabled}
                            onChange={v => aggiorna(righe.map((x, j) => (j === i ? v : x)))}
                        />
                    </div>
                    {righe.length > 1 && (
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() => aggiorna(righe.filter((_, j) => j !== i))}
                            title="Togli questo numero"
                            aria-label="Togli questo numero"
                            className="shrink-0 px-2.5 py-2 rounded-lg border border-theme-border text-sm text-theme-text-muted hover:text-red-400 disabled:opacity-50"
                        >×</button>
                    )}
                </div>
            ))}
            <button
                type="button"
                disabled={disabled}
                onClick={() => setRighe([...righe, ''])}
                className="text-xs text-dr7-gold hover:underline disabled:opacity-50"
            >+ Aggiungi numero</button>
        </div>
    )
}
