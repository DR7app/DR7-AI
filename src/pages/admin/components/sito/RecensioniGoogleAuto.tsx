import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../supabaseClient'
import { authFetch } from '../../../../utils/authFetch'

/**
 * Recensioni Google (automatiche), 26/09/2026.
 *
 * Le recensioni vere arrivano da sole ogni tre ore (sync-google-reviews-cron)
 * in google_reviews_cache e il sito le mostra dalla piu' recente. Da qui si
 * vede cosa c'e', si nasconde una recensione e si forza un aggiornamento.
 * Testo, nome e stelle non si modificano: sono quelli di Google.
 */

interface Riga {
    id: string
    source: 'gbp' | 'places'
    author: string | null
    rating: number | null
    text: string | null
    published_at: string | null
    reply: string | null
    hidden: boolean
}

interface Sintesi {
    rating: number | null
    total: number | null
    source: string | null
    last_success_at: string | null
    last_error: string | null
}

const dataOra = (iso: string | null) => iso
    ? new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'
const data = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—'

function Stelle({ n }: { n: number }) {
    return (
        <span className="inline-flex gap-0.5" aria-label={`${n} stelle su 5`}>
            {[1, 2, 3, 4, 5].map(i => (
                <svg key={i} width="11" height="11" viewBox="0 0 24 24" className={i <= n ? 'text-amber-500' : 'text-theme-text-muted opacity-40'} fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
            ))}
        </span>
    )
}

export default function RecensioniGoogleAuto() {
    const [righe, setRighe] = useState<Riga[]>([])
    const [sintesi, setSintesi] = useState<Sintesi | null>(null)
    const [caricamento, setCaricamento] = useState(true)
    const [tabellaMancante, setTabellaMancante] = useState(false)
    const [sincronizzo, setSincronizzo] = useState(false)
    const [inCorso, setInCorso] = useState<string | null>(null)

    const carica = useCallback(async () => {
        setCaricamento(true)
        const [r, s] = await Promise.all([
            supabase.from('google_reviews_cache')
                .select('id, source, author, rating, text, published_at, reply, hidden')
                .order('published_at', { ascending: false }).limit(200),
            supabase.from('google_reviews_summary')
                .select('rating, total, source, last_success_at, last_error').eq('id', 'main').maybeSingle(),
        ])
        if (r.error && /does not exist|schema cache|42P01|PGRST205/i.test(`${r.error.code} ${r.error.message}`)) {
            setTabellaMancante(true)
        } else if (r.error) {
            toast.error(`Recensioni Google non leggibili: ${r.error.message}`)
        } else {
            setTabellaMancante(false)
            setRighe((r.data || []) as Riga[])
        }
        setSintesi((s.data as Sintesi | null) || null)
        setCaricamento(false)
    }, [])

    useEffect(() => { void carica() }, [carica])

    async function sincronizza() {
        setSincronizzo(true)
        try {
            const res = await authFetch('/.netlify/functions/sync-google-reviews', { method: 'POST' })
            const esito = await res.json().catch(() => ({})) as { ok?: boolean; nuove?: number; source?: string; errore?: string; error?: string; avviso?: string }
            if (!res.ok || !esito.ok) {
                toast.error(esito.errore || esito.error || `Sincronizzazione non riuscita (HTTP ${res.status})`, { duration: 10000 })
            } else {
                const fonte = esito.source === 'gbp' ? 'Google Business' : 'Google Maps'
                toast.success(`Aggiornate da ${fonte}: ${esito.nuove || 0} nuove recensioni.`, { duration: 8000 })
            }
            await carica()
        } catch (e) {
            toast.error((e as Error).message)
        } finally {
            setSincronizzo(false)
        }
    }

    async function cambiaVisibilita(r: Riga) {
        setInCorso(r.id)
        const { error } = await supabase.from('google_reviews_cache').update({ hidden: !r.hidden }).eq('id', r.id)
        setInCorso(null)
        if (error) { toast.error(`Non salvato: ${error.message}`); return }
        setRighe(prev => prev.map(x => x.id === r.id ? { ...x, hidden: !r.hidden } : x))
        toast.success(r.hidden ? 'Recensione di nuovo visibile sul sito.' : 'Recensione nascosta dal sito.')
    }

    const visibili = righe.filter(r => !r.hidden).length

    return (
        <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold text-theme-text-primary">Recensioni Google (automatiche)</h3>
                    <p className="text-[12px] text-theme-text-secondary mt-0.5">
                        Arrivano da sole ogni tre ore e il sito le mostra dalla piu recente. Nome, stelle e testo sono quelli di Google.
                    </p>
                </div>
                <button
                    onClick={() => void sincronizza()}
                    disabled={sincronizzo || tabellaMancante}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#007aff] text-white hover:bg-[#0066d6] disabled:opacity-50"
                >
                    {sincronizzo ? 'Sincronizzazione...' : 'Sincronizza ora'}
                </button>
            </div>

            {tabellaMancante ? (
                <p className="text-[12px] text-amber-700 dark:text-amber-300">
                    La copia delle recensioni non esiste ancora: va eseguita la migrazione supabase/migrations/20260926_recensioni_google.sql. Fino ad allora il sito chiede le recensioni direttamente a Google.
                </p>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-theme-text-muted">Ultimo aggiornamento</p>
                            <p className="text-theme-text-primary mt-0.5">{dataOra(sintesi?.last_success_at || null)}</p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-theme-text-muted">Fonte</p>
                            <p className="text-theme-text-primary mt-0.5">
                                {sintesi?.source === 'gbp' ? 'Google Business: tutte' : sintesi?.source === 'places' ? 'Google Maps: 5 piu recenti per volta' : '—'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-theme-text-muted">Valutazione</p>
                            <p className="text-theme-text-primary mt-0.5">
                                {sintesi?.rating != null ? `${Number(sintesi.rating).toFixed(1)}/5` : '—'}
                                {sintesi?.total != null ? ` · ${sintesi.total} recensioni su Google` : ''}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-theme-text-muted">Sul sito</p>
                            <p className="text-theme-text-primary mt-0.5">{visibili} visibili su {righe.length} copiate</p>
                        </div>
                    </div>

                    {sintesi?.last_error && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">{sintesi.last_error}</p>
                    )}

                    {caricamento ? (
                        <p className="text-[12px] text-theme-text-muted">Caricamento...</p>
                    ) : !righe.length ? (
                        <p className="text-[12px] text-theme-text-muted">Nessuna recensione copiata finora: premi Sincronizza ora.</p>
                    ) : (
                        <div className="divide-y divide-theme-border border border-theme-border rounded-xl max-h-[520px] overflow-y-auto">
                            {righe.map(r => (
                                <div key={r.id} className={`px-3 py-2.5 flex items-start gap-3 ${r.hidden ? 'opacity-50' : ''}`}>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[13px] font-medium text-theme-text-primary">{r.author || 'Cliente Google'}</span>
                                            <Stelle n={r.rating || 0} />
                                            <span className="text-[11px] text-theme-text-muted">{data(r.published_at)}</span>
                                            {r.hidden && <span className="text-[10px] px-1.5 py-0.5 rounded border border-theme-border text-theme-text-secondary">NASCOSTA</span>}
                                        </div>
                                        {r.text
                                            ? <p className="text-[12px] text-theme-text-secondary mt-1 whitespace-pre-line line-clamp-4">{r.text}</p>
                                            : <p className="text-[11px] text-theme-text-muted mt-1">Solo stelle, senza testo: sul sito non compare.</p>}
                                        {r.reply && (
                                            <p className="text-[11px] text-theme-text-muted mt-1 border-l-2 border-theme-border pl-2">Risposta DR7: {r.reply}</p>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => void cambiaVisibilita(r)}
                                        disabled={inCorso === r.id}
                                        className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium border border-theme-border text-theme-text-primary hover:bg-theme-bg-secondary disabled:opacity-50"
                                    >
                                        {r.hidden ? 'Mostra' : 'Nascondi'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </section>
    )
}
