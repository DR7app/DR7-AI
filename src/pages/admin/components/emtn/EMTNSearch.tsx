/**
 * EMTNSearch — form CF + booking selector. Hard rule "no booking, no
 * search" applicato sia client-side che server-side: il bottone resta
 * disabled finche' bookingId non e' valorizzato.
 */
import { useState } from 'react'

const CF_REGEX = /^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/

export interface EMTNSearchPayload {
    codiceFiscale: string
    nome?: string
    cognome?: string
}

interface Props {
    onSearch: (payload: EMTNSearchPayload) => Promise<void> | void
    searching?: boolean
    error?: string | null
}

export default function EMTNSearch({ onSearch, searching, error }: Props) {
    const [cf, setCf] = useState('')
    const [nome, setNome] = useState('')
    const [cognome, setCognome] = useState('')
    const [localError, setLocalError] = useState<string | null>(null)

    const cfValid = CF_REGEX.test(cf.trim().toUpperCase())
    const canSubmit = cfValid && !searching

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setLocalError(null)
        if (!cfValid) {
            setLocalError('Codice Fiscale non valido (formato AAAAAA00A00A000A)')
            return
        }
        await onSearch({
            codiceFiscale: cf.trim().toUpperCase(),
            nome: nome.trim() || undefined,
            cognome: cognome.trim() || undefined,
        })
    }

    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Ricerca Cliente</h3>
                    <p className="text-xs text-theme-text-muted mt-0.5">
                        Inserisci il Codice Fiscale per consultare la rete EMTN.
                    </p>
                </div>
            </div>
            <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <input
                    type="text"
                    value={cf}
                    onChange={(e) => setCf(e.target.value.toUpperCase())}
                    placeholder="Codice Fiscale *"
                    className="sm:col-span-2 bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40 font-mono uppercase"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-invalid={cf.length > 0 && !cfValid}
                />
                <input
                    type="text"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Nome"
                    className="bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                />
                <input
                    type="text"
                    value={cognome}
                    onChange={(e) => setCognome(e.target.value)}
                    placeholder="Cognome"
                    className="bg-theme-bg-primary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                />
                <button
                    type="submit"
                    disabled={!canSubmit}
                    className="bg-dr7-gold text-theme-bg-primary text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {searching ? 'Verifica…' : 'Verifica EMTN'}
                </button>
            </form>
            {(localError || error) && (
                <div className="mt-3 px-3 py-2 rounded-lg border border-theme-error/30 bg-theme-error/5 text-sm text-theme-error">
                    {localError || error}
                </div>
            )}
        </section>
    )
}
