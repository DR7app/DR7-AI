/**
 * EMTN — CODA APPROVAZIONI (workflow, fasi 9-11). Solo direzione.
 *
 * Ogni pratica inviata da un operatore arriva qui con tutto quello che serve
 * a decidere: operatore, cliente, contratto, veicolo, eventi, importi, stato,
 * esito del controllo AI e del gestionale, incongruenze, risposte del cliente,
 * documenti (link temporanei). Decisioni: Approva, Richiedi integrazione,
 * Rettifica prima della pubblicazione, Sospendi, Rifiuta, Revisione
 * privacy/legale. Solo Approva/Rettifica pubblicano nella rete.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../../utils/authFetch'
import { TabellaControlli } from './EMTNPraticaModal'
import {
    AVVISO_LEGALE, DECISIONI_EMTN, categoriaEMTN, etichettaStato,
    type ControlloGestionale, type DecisioneEMTN, type EventoEMTN,
} from '../../../../utils/emtnMobilityRisk'

interface PosizioneCoda {
    id: string
    stato: string
    titolo: string
    report: string
    eventi: EventoEMTN[]
    pratica: Record<string, string | null>
    documenti: { path: string; nome: string; sha256?: string }[]
    incongruenze: string[]
    esito_verifica: string | null
    controlli_gestionale: ControlloGestionale[]
    motivi_revisione: string[]
    informazioni_legali: string[]
    revisione_legale: boolean
    email_cliente: string | null
    inviata_at: string | null
    inviata_da: string | null
    pubblicata: boolean
    decisione: string | null
    nota_revisione: string | null
    emtn_clients: { codice_fiscale: string; nome: string | null; cognome: string | null } | null
    risposte_cliente: { nota: string; created_at: string }[]
}

const dataOra = (v: string | null) => v ? new Date(v).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
const euro = (v: unknown) => {
    const n = Number(v)
    return v == null || !Number.isFinite(n) ? '—' : `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function chiama<T>(corpo: Record<string, unknown>): Promise<{ ok: boolean; data: T }> {
    const res = await authFetch('/.netlify/functions/emtn-pratica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    return { ok: res.ok, data: await res.json().catch(() => ({})) as T }
}

export default function EMTNCodaApprovazioni() {
    const [coda, setCoda] = useState<PosizioneCoda[] | null>(null)
    const [errore, setErrore] = useState<string | null>(null)

    async function carica() {
        const r = await chiama<{ coda?: PosizioneCoda[]; error?: string }>({ azione: 'coda' })
        if (!r.ok) { setErrore(r.data.error || 'Coda non disponibile'); return }
        setErrore(null)
        setCoda(r.data.coda || [])
    }
    useEffect(() => { carica() }, [])

    if (errore) return <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-6 text-sm text-theme-text-secondary">{errore}</div>
    if (!coda) return <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-6 text-sm text-theme-text-muted">Caricamento…</div>
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-theme-text-primary">Coda approvazioni EMTN <span className="text-theme-text-muted font-normal">({coda.length})</span></h2>
                <button type="button" onClick={carica} className="px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-text-primary hover:bg-theme-bg-hover">Aggiorna</button>
            </div>
            {coda.length === 0 && <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-6 text-sm text-theme-text-muted">Nessuna segnalazione in attesa.</div>}
            {coda.map(p => <SchedaApprovazione key={p.id} p={p} onDeciso={carica} />)}
        </div>
    )
}

function SchedaApprovazione({ p, onDeciso }: { p: PosizioneCoda; onDeciso: () => void }) {
    const [nota, setNota] = useState('')
    const [rettifica, setRettifica] = useState(false)
    const [titolo, setTitolo] = useState(p.titolo)
    const [report, setReport] = useState(p.report)
    const [invio, setInvio] = useState(false)
    const [errori, setErrori] = useState<string[]>([])
    const cliente = p.emtn_clients

    async function apri(path: string) {
        const r = await chiama<{ url?: string; error?: string }>({ azione: 'documento', posizioneId: p.id, path })
        if (r.data.url) window.open(r.data.url, '_blank', 'noopener')
        else toast.error(r.data.error || 'Documento non disponibile')
    }

    async function decidi(decisione: DecisioneEMTN) {
        setErrori([]); setInvio(true)
        const r = await chiama<{ error?: string; errori?: string[] }>({
            azione: 'decisione', posizioneId: p.id, decisione, nota,
            risultato: decisione === 'rettifica' ? {
                titolo, report, eventi: p.eventi, stato_posizione: p.stato, informazioni_legali: p.informazioni_legali,
                pratica: p.pratica, documenti: [], esito_verifica: p.esito_verifica,
            } : undefined,
        })
        setInvio(false)
        if (!r.ok) { setErrori(r.data.errori || [r.data.error || 'Decisione non salvata']); return }
        toast.success(DECISIONI_EMTN.find(d => d.id === decisione)?.label || 'Salvato')
        onDeciso()
    }

    const importi = p.eventi.map(e => e.dati.importo_residuo ?? e.dati.importo_dovuto ?? e.dati.importo_richiesto).filter(v => v != null)
    return (
        <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <p className="text-sm font-bold text-theme-text-primary">{p.titolo || 'Senza titolo'}</p>
                    <p className="text-xs text-theme-text-muted">
                        {cliente ? `${cliente.nome || ''} ${cliente.cognome || ''}`.trim() : '—'} · {cliente?.codice_fiscale || '—'} · inviata da {p.inviata_da || '—'} il {dataOra(p.inviata_at)}
                    </p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                    <span className="rounded-full border border-theme-border px-2 py-0.5 text-theme-text-secondary">{etichettaStato(p.stato)}</span>
                    <span className={`rounded-full px-2 py-0.5 ${p.motivi_revisione.length ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-green-500/10 text-green-700 dark:text-green-300'}`}>
                        {(p.esito_verifica || 'n/d').replace(/_/g, ' ')}
                    </span>
                    {p.pubblicata && <span className="rounded-full bg-theme-bg-tertiary px-2 py-0.5 text-theme-text-secondary">Gia' pubblicata · aggiornamento</span>}
                    {p.revisione_legale && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-700 dark:text-red-300">Revisione legale</span>}
                </div>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                {[
                    ['Contratto', p.pratica?.numero_contratto], ['Veicolo', [p.pratica?.veicolo, p.pratica?.targa].filter(Boolean).join(' ')],
                    ['Periodo', [p.pratica?.inizio_noleggio, p.pratica?.fine_noleggio].filter(Boolean).join(' → ')], ['Importo', importi.length ? euro(Math.max(...importi.map(Number))) : '—'],
                    ['Email cliente', p.email_cliente],
                ].map(([k, v]) => (
                    <div key={k as string}><dt className="text-theme-text-muted">{k}</dt><dd className="text-theme-text-primary">{v || '—'}</dd></div>
                ))}
            </dl>

            <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Eventi</p>
                <ul className="space-y-0.5 text-xs text-theme-text-primary">
                    {p.eventi.map((e, i) => (
                        <li key={i}>{e.codice}. {categoriaEMTN(e.codice)?.label} · {etichettaStato(e.stato)} · dovuto {euro(e.dati.importo_dovuto ?? e.dati.importo_richiesto)} · pagato {euro(e.dati.importo_pagato)} · residuo {euro(e.dati.importo_residuo)}{e.dati.ritardo ? ` · ritardo ${e.dati.ritardo}` : ''}</li>
                    ))}
                </ul>
            </div>

            {p.motivi_revisione.length > 0 && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    <p className="font-bold">REVISIONE MANUALE OBBLIGATORIA</p>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5">{p.motivi_revisione.map((m, i) => <li key={i}>{m}</li>)}</ul>
                </div>
            )}
            {p.controlli_gestionale.length > 0 && <TabellaControlli controlli={p.controlli_gestionale} />}
            {p.risposte_cliente.length > 0 && (
                <div className="rounded-lg border border-theme-border bg-theme-bg-primary px-3 py-2 text-xs">
                    <p className="font-bold text-theme-text-primary mb-1">Risposte / contestazioni del cliente</p>
                    {p.risposte_cliente.map((r, i) => <p key={i} className="text-theme-text-secondary"><span className="text-theme-text-muted">{dataOra(r.created_at)}:</span> {r.nota}</p>)}
                </div>
            )}
            {p.informazioni_legali.length > 0 && (
                <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    <p className="font-bold">{AVVISO_LEGALE}</p>
                    <ul className="list-disc pl-5 mt-1">{p.informazioni_legali.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
            )}

            <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Report {rettifica ? '(rettifica)' : ''}</p>
                {rettifica ? (
                    <div className="space-y-1.5">
                        <input className="w-full bg-theme-bg-primary border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-theme-text-primary" value={titolo} onChange={e => setTitolo(e.target.value)} />
                        <textarea className="w-full min-h-[120px] bg-theme-bg-primary border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-theme-text-primary" value={report} onChange={e => setReport(e.target.value)} />
                    </div>
                ) : (
                    <p className="whitespace-pre-line text-xs text-theme-text-secondary">{p.report}</p>
                )}
            </div>

            <div className="flex flex-wrap gap-1.5">
                {p.documenti.map(d => (
                    <button key={d.path} type="button" onClick={() => apri(d.path)} className="rounded-lg border border-theme-border px-2 py-1 text-[11px] text-theme-text-primary hover:bg-theme-bg-hover">{d.nome}</button>
                ))}
            </div>

            {errori.length > 0 && <ul className="text-[11px] text-red-600 dark:text-red-400 list-disc pl-5">{errori.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            <textarea value={nota} onChange={e => setNota(e.target.value)} placeholder="Motivazione (obbligatoria per integrazione, sospensione, rifiuto e revisione legale)"
                className="w-full min-h-[56px] bg-theme-bg-primary border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-theme-text-primary placeholder:text-theme-text-muted" />
            <div className="flex flex-wrap gap-2">
                <button type="button" disabled={invio} onClick={() => decidi('approva')} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50">Approva e pubblica</button>
                {rettifica
                    ? <button type="button" disabled={invio} onClick={() => decidi('rettifica')} className="px-3 py-1.5 rounded-lg bg-dr7-gold text-black text-xs font-semibold disabled:opacity-50">Pubblica rettificata</button>
                    : <button type="button" onClick={() => setRettifica(true)} className="px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-text-primary">Rettifica prima della pubblicazione</button>}
                <button type="button" disabled={invio} onClick={() => decidi('integrazione')} className="px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-text-primary disabled:opacity-50">Richiedi integrazione</button>
                <button type="button" disabled={invio} onClick={() => decidi('sospendi')} className="px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-text-primary disabled:opacity-50">Sospendi</button>
                <button type="button" disabled={invio} onClick={() => decidi('legale')} className="px-3 py-1.5 rounded-lg border border-red-500/50 text-xs text-red-600 dark:text-red-400 disabled:opacity-50">Revisione privacy/legale</button>
                <button type="button" disabled={invio} onClick={() => decidi('rifiuta')} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-50">Rifiuta</button>
            </div>
        </section>
    )
}
