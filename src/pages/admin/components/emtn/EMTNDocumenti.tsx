/**
 * EMTN — documenti di una pratica: elenco, anteprima, apertura e download.
 *
 * 01/10/2026 (Ophelie): i documenti inviati con una pratica non si vedevano
 * dalla scheda cliente. Qui ogni documento ha un'anteprima (PDF e immagini
 * dentro la pagina), "Apri in una nuova scheda" e "Scarica". I file restano
 * nell'area protetta: ogni apertura chiede un link temporaneo (5 minuti) a
 * emtn-pratica, che registra l'accesso nel log EMTN.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { authFetch } from '../../../../utils/authFetch'

export interface DocumentoPratica {
    path: string
    nome: string
    mime: string | null
    size: number | null
    origine: string | null
    caricato_at: string | null
}

const tipoFile = (d: DocumentoPratica): 'pdf' | 'immagine' | 'altro' => {
    const m = String(d.mime || '').toLowerCase()
    const n = d.nome.toLowerCase()
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf'
    if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/.test(n)) return 'immagine'
    return 'altro'
}
const dimensione = (b: number | null) => b == null ? '' : b >= 1_048_576 ? `${(b / 1_048_576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
const dataBreve = (v: string | null) => v ? new Date(v).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' }) : ''

async function linkTemporaneo(posizioneId: string, d: DocumentoPratica, scarica = false): Promise<string | null> {
    const res = await authFetch('/.netlify/functions/emtn-pratica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'documento', posizioneId, path: d.path, scarica, nome: d.nome }),
    })
    const j = await res.json().catch(() => ({})) as { url?: string | null; error?: string }
    if (!res.ok || !j.url) {
        toast.error(j.error || 'Documento non disponibile')
        return null
    }
    return j.url
}

function IconaFile({ tipo }: { tipo: ReturnType<typeof tipoFile> }) {
    return (
        <div className={`w-9 h-11 shrink-0 rounded-md border grid place-items-center text-[9px] font-bold ${
            tipo === 'pdf' ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
                : tipo === 'immagine' ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                    : 'border-theme-border bg-theme-bg-tertiary text-theme-text-secondary'}`}>
            {tipo === 'pdf' ? 'PDF' : tipo === 'immagine' ? 'IMG' : 'FILE'}
        </div>
    )
}

export default function EMTNDocumenti({ posizioneId, documenti }: { posizioneId: string; documenti: DocumentoPratica[] }) {
    const [aperto, setAperto] = useState<{ doc: DocumentoPratica; url: string } | null>(null)
    const [caricando, setCaricando] = useState<string | null>(null)
    const [scaricando, setScaricando] = useState<string | null>(null)
    // Sul telefono un PDF dentro la pagina spesso non si vede: si apre a parte.
    const schermoPiccolo = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches

    useEffect(() => {
        if (!aperto) return
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAperto(null) }
        window.addEventListener('keydown', esc)
        const overflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            window.removeEventListener('keydown', esc)
            document.body.style.overflow = overflow
        }
    }, [aperto])

    async function anteprima(d: DocumentoPratica) {
        if (schermoPiccolo && tipoFile(d) === 'pdf') { await nuovaScheda(d); return }
        setCaricando(d.path)
        const url = await linkTemporaneo(posizioneId, d)
        setCaricando(null)
        if (url) setAperto({ doc: d, url })
    }
    async function nuovaScheda(d: DocumentoPratica) {
        // La scheda si apre subito (i browser bloccano window.open dopo un await).
        const w = window.open('', '_blank')
        if (!w) {
            toast.error('Il browser ha bloccato la nuova scheda: usa Anteprima o Scarica')
            return
        }
        w.opener = null
        const url = await linkTemporaneo(posizioneId, d)
        if (url) w.location.href = url
        else w.close()
    }
    async function scarica(d: DocumentoPratica) {
        if (scaricando) return
        setScaricando(d.path)
        const url = await linkTemporaneo(posizioneId, d, true)
        setScaricando(null)
        if (!url) return
        const a = document.createElement('a')
        a.href = url
        a.download = d.nome
        document.body.appendChild(a)
        a.click()
        a.remove()
    }

    if (documenti.length === 0) return null

    return (
        <div className="mt-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">Documenti ({documenti.length})</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {documenti.map(d => {
                    const tipo = tipoFile(d)
                    return (
                        <div key={d.path} className="flex items-center gap-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-2 min-w-0">
                            <button type="button" onClick={() => anteprima(d)} className="shrink-0" title="Anteprima">
                                <IconaFile tipo={tipo} />
                            </button>
                            <div className="min-w-0 flex-1">
                                <button type="button" onClick={() => anteprima(d)}
                                    className="block w-full text-left text-[11px] font-medium text-theme-text-primary truncate hover:underline">
                                    {d.nome}
                                </button>
                                <p className="text-[10px] text-theme-text-muted truncate">
                                    {[dimensione(d.size), d.origine === 'gestionale' ? 'dal gestionale' : 'caricato', dataBreve(d.caricato_at)].filter(Boolean).join(' · ')}
                                </p>
                                <div className="flex gap-2 mt-0.5">
                                    <button type="button" onClick={() => anteprima(d)} disabled={caricando === d.path}
                                        className="text-[10px] font-semibold text-cyan-700 dark:text-cyan-400 hover:underline disabled:opacity-50">
                                        {caricando === d.path ? 'Apertura...' : 'Anteprima'}
                                    </button>
                                    <button type="button" onClick={() => nuovaScheda(d)} className="text-[10px] text-theme-text-secondary hover:text-theme-text-primary">Apri</button>
                                    <button type="button" onClick={() => scarica(d)} disabled={scaricando === d.path}
                                        className="text-[10px] text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50">
                                        {scaricando === d.path ? 'Download...' : 'Scarica'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {aperto && createPortal(
                <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-2 sm:p-6" onClick={() => setAperto(null)}>
                    <div role="dialog" aria-modal="true" aria-label={aperto.doc.nome}
                        className="w-full max-w-5xl h-[90dvh] flex flex-col rounded-2xl border border-theme-border bg-theme-bg-primary overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-theme-border">
                            <p className="flex-1 min-w-0 text-sm font-semibold text-theme-text-primary truncate">{aperto.doc.nome}</p>
                            {/* Link nuovo: quello dell'anteprima scade dopo 5 minuti. */}
                            <button type="button" onClick={() => nuovaScheda(aperto.doc)}
                                className="px-2.5 py-1 rounded-lg border border-theme-border text-[11px] text-theme-text-primary hover:bg-theme-bg-hover">Apri</button>
                            <button type="button" onClick={() => scarica(aperto.doc)}
                                className="px-2.5 py-1 rounded-lg border border-theme-border text-[11px] text-theme-text-primary hover:bg-theme-bg-hover">Scarica</button>
                            <button type="button" onClick={() => setAperto(null)} aria-label="Chiudi"
                                className="px-2.5 py-1 rounded-lg text-[11px] text-theme-text-secondary hover:bg-theme-bg-hover">Chiudi</button>
                        </div>
                        <div className="flex-1 min-h-0 bg-theme-bg-secondary">
                            {tipoFile(aperto.doc) === 'immagine' ? (
                                <div className="w-full h-full overflow-auto grid place-items-center p-3">
                                    <img src={aperto.url} alt={aperto.doc.nome} className="max-w-full max-h-full object-contain" />
                                </div>
                            ) : tipoFile(aperto.doc) === 'pdf' ? (
                                <iframe src={aperto.url} title={aperto.doc.nome} className="w-full h-full border-0" />
                            ) : (
                                <div className="w-full h-full grid place-items-center p-6 text-center">
                                    <p className="text-sm text-theme-text-secondary">Anteprima non disponibile per questo tipo di file. Usa "Apri in una nuova scheda" o "Scarica".</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    )
}
