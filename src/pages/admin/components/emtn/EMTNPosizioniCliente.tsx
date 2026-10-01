/**
 * EMTN — posizioni del cliente (Mobility Risk Report).
 *
 * Mostra ogni posizione con stato corrente, fase di validazione e, se
 * pubblicata, la versione che vede la rete. Da qui si aggiorna una posizione
 * con nuovi documenti (pagamento, accordo, contestazione) e si registra la
 * risposta del cliente, che riapre la verifica (workflow, fase 12).
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../../utils/authFetch'
import { categoriaEMTN, etichettaStato, type EventoEMTN } from '../../../../utils/emtnMobilityRisk'
import EMTNDocumenti, { type DocumentoPratica } from './EMTNDocumenti'

interface Posizione {
    id: string
    stato: string
    titolo: string
    report: string
    eventi: EventoEMTN[]
    esito_verifica: string | null
    in_approvazione: boolean
    pubblicata: boolean
    decisione: string | null
    nota_revisione: string | null
    revisione_legale: boolean
    inviata_at: string | null
    approvata_at: string | null
    updated_at: string
    documenti?: DocumentoPratica[]
}

const data = (v: string | null) => v ? new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—'

function fase(p: Posizione): { testo: string; cls: string } {
    if (p.in_approvazione) return { testo: 'In coda approvazione', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    if (p.pubblicata) return { testo: 'Pubblicata nella rete', cls: 'bg-green-500/10 text-green-700 dark:text-green-300' }
    if (p.decisione === 'rifiuta') return { testo: 'Rifiutata', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' }
    if (p.decisione === 'integrazione') return { testo: 'Integrazione richiesta', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    if (p.decisione === 'sospendi') return { testo: 'Sospesa', cls: 'bg-theme-bg-tertiary text-theme-text-secondary' }
    return { testo: 'Non pubblicata', cls: 'bg-theme-bg-tertiary text-theme-text-secondary' }
}

export default function EMTNPosizioniCliente({ clientId, versione, onAggiorna }: {
    clientId: string
    /** Cambia quando una pratica viene inviata: si ricarica la lista. */
    versione: number
    onAggiorna: (posizioneId: string) => void
}) {
    const [posizioni, setPosizioni] = useState<Posizione[]>([])
    const [rispostaPer, setRispostaPer] = useState<string | null>(null)
    const [testo, setTesto] = useState('')
    // Il testo della posizione resta chiuso: si apre solo su richiesta.
    const [aperte, setAperte] = useState<Set<string>>(new Set())
    const apriChiudi = (id: string) => setAperte(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })

    async function carica() {
        const res = await authFetch('/.netlify/functions/emtn-pratica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'posizioni', clientId }) })
        const j = await res.json().catch(() => ({})) as { posizioni?: Posizione[] }
        setPosizioni(j.posizioni || [])
    }
    useEffect(() => { carica() }, [clientId, versione]) // eslint-disable-line react-hooks/exhaustive-deps

    async function salvaRisposta(posizioneId: string) {
        const res = await authFetch('/.netlify/functions/emtn-pratica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'risposta_cliente', posizioneId, testo }) })
        const j = await res.json().catch(() => ({})) as { error?: string }
        if (!res.ok) { toast.error(j.error || 'Non salvata'); return }
        toast.success('Risposta registrata: la verifica e\' riaperta')
        setRispostaPer(null); setTesto('')
        carica()
    }

    if (posizioni.length === 0) return null
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-3">Posizioni EMTN ({posizioni.length})</h3>
            <div className="space-y-3">
                {posizioni.map(p => {
                    const f = fase(p)
                    return (
                        <div key={p.id} className="rounded-xl border border-theme-border bg-theme-bg-primary p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="text-sm font-semibold text-theme-text-primary">{p.titolo || 'Senza titolo'}</p>
                                <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                                    <span className="rounded-full border border-theme-border px-2 py-0.5 text-theme-text-secondary">{etichettaStato(p.stato)}</span>
                                    <span className={`rounded-full px-2 py-0.5 ${f.cls}`}>{f.testo}</span>
                                </div>
                            </div>
                            <p className="text-[11px] text-theme-text-muted mt-0.5">
                                {p.eventi.map(e => categoriaEMTN(e.codice)?.label).filter(Boolean).join(' · ')} · inviata {data(p.inviata_at)}{p.approvata_at ? ` · approvata ${data(p.approvata_at)}` : ''}
                            </p>
                            {p.nota_revisione && <p className="text-[11px] text-theme-text-secondary mt-1">Nota EMTN: {p.nota_revisione}</p>}
                            {p.report && (
                                <button type="button" onClick={() => apriChiudi(p.id)} aria-expanded={aperte.has(p.id)}
                                    className="mt-2 text-[11px] font-semibold text-theme-text-secondary hover:text-theme-text-primary">
                                    {aperte.has(p.id) ? 'Nascondi messaggio' : 'Mostra messaggio'}
                                </button>
                            )}
                            {p.report && aperte.has(p.id) && <p className="whitespace-pre-line text-xs text-theme-text-secondary mt-1">{p.report}</p>}
                            <EMTNDocumenti posizioneId={p.id} documenti={p.documenti || []} />
                            <div className="flex flex-wrap gap-2 mt-2">
                                <button type="button" onClick={() => onAggiorna(p.id)} className="px-2.5 py-1 rounded-lg border border-theme-border text-[11px] text-theme-text-primary hover:bg-theme-bg-hover">Aggiorna con nuovi documenti</button>
                                <button type="button" onClick={() => setRispostaPer(rispostaPer === p.id ? null : p.id)} className="px-2.5 py-1 rounded-lg border border-theme-border text-[11px] text-theme-text-primary hover:bg-theme-bg-hover">Registra risposta del cliente</button>
                            </div>
                            {rispostaPer === p.id && (
                                <div className="mt-2 space-y-1.5">
                                    <textarea value={testo} onChange={e => setTesto(e.target.value)} placeholder="Osservazioni, contestazione o richiesta di rettifica del cliente"
                                        className="w-full min-h-[64px] bg-theme-bg-secondary border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-theme-text-primary placeholder:text-theme-text-muted" />
                                    <button type="button" onClick={() => salvaRisposta(p.id)} disabled={testo.trim().length < 5}
                                        className="px-3 py-1 rounded-lg bg-dr7-gold text-black text-[11px] font-semibold disabled:opacity-50">Salva e riapri la verifica</button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </section>
    )
}
