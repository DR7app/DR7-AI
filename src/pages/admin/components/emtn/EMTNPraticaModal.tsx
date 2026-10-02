/**
 * EMTN — pratica di segnalazione con analisi documentale AI.
 *
 * 28/09/2026 (direzione, "Specifica funzionale definitiva" + "Workflow
 * definitivo"): l'operatore NON compila l'evento a mano. Carica i documenti,
 * l'AI li legge, classifica gli eventi, estrae i dati, li confronta tra loro e
 * con il gestionale; l'operatore rivede e corregge, poi INVIA: email al
 * cliente (Messaggi di Sistema Pro) e richiesta di approvazione a DR7. Niente
 * diventa visibile alla rete prima dell'approvazione della direzione EMTN.
 *
 * `posizioneId` = aggiornamento di una posizione esistente con nuovi
 * documenti (pagamento, accordo, contestazione): stessa pratica, cronologia
 * conservata.
 */
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../../utils/authFetch'
import SelettoreCategorieEMTN, { type OpzioneCategoria } from './SelettoreCategorieEMTN'
import BarraRicerca from '../../../../components/admin/BarraRicerca'
import { corrispondeRicerca } from '../../../../utils/ricerca'
import {
    AREE_EMTN, CATEGORIE_EMTN, CAMPI_EVENTO, CAMPI_PRATICA, STATI_EMTN, TIPI_DOCUMENTO, NON_RISULTA, AVVISO_LEGALE,
    categoriaEMTN, etichettaStato, normalizzaRisultato, motiviRevisioneManuale,
    type RisultatoAnalisi, type EventoEMTN, type ControlloGestionale,
} from '../../../../utils/emtnMobilityRisk'

const OPZIONI_EMTN: OpzioneCategoria[] = CATEGORIE_EMTN.map(c => ({
    id: String(c.codice), label: `${c.codice}. ${c.label}`, helper: c.descrizione, gruppo: `Area ${c.area} – ${AREE_EMTN[c.area]}`,
}))

const ACCETTATI = '.pdf,.jpg,.jpeg,.png,.webp'
const DOCUMENTI_SUGGERITI = [
    'Contratto di noleggio', 'Verbale check-out / check-in', 'Foto del veicolo', 'Preventivo o perizia', 'Fattura o nota di debito',
    'Richiesta di pagamento', 'Ricevute dei pagamenti', 'Accordi transattivi', 'Comunicazioni / contestazioni del cliente',
]

type Fase = 'documenti' | 'analisi' | 'revisione' | 'inviata'

interface StatoAnalisi {
    stato: 'caricamento' | 'in_corso' | 'pronta' | 'errore' | 'inviata'
    risultato: (RisultatoAnalisi & { motivi_revisione?: string[] }) | null
    avvisi: string[]
    controlli_gestionale: ControlloGestionale[]
    documenti: { nome: string; size: number; sha256: string }[]
    errore: string | null
    emailCliente: string | null
}

interface Noleggio {
    id: string
    veicolo: string | null
    targa: string | null
    ritiro: string | null
    riconsegna: string | null
    danni: { label: string; importo: number; pagato: boolean }[]
    penali: { label: string; importo: number; pagato: boolean }[]
    non_pagato: number
    contratto: string | null
    insoluto: number
    documenti: { nome: string; tipo: string; descrizione: string }[] | null
}

const giorno = (v: string | null) => v ? new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—'
const eur = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface Props {
    open: boolean
    onClose: () => void
    onInviata: () => void
    clientId: string
    nomeCliente: string
    posizioneId?: string | null
    /** Testo di contesto (es. la voce di danno da cui parte la segnalazione). */
    contesto?: string | null
    /** Noleggio della voce di danno/penale da cui parte la segnalazione. */
    bookingId?: string | null
}

const inputCls = 'w-full bg-theme-bg-primary border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-1 focus:ring-dr7-gold/50'
const ESITO_COLORE: Record<string, string> = {
    DOCUMENTAZIONE_COERENTE: 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300',
    DOCUMENTAZIONE_PARZIALMENTE_COMPLETA: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
}
const esitoCls = (e: string) => ESITO_COLORE[e] || 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'

export default function EMTNPraticaModal({ open, onClose, onInviata, clientId, nomeCliente, posizioneId = null, contesto = null, bookingId = null }: Props) {
    const [fase, setFase] = useState<Fase>('documenti')
    const [files, setFiles] = useState<File[]>([])
    const [analisiId, setAnalisiId] = useState<string | null>(null)
    const [stato, setStato] = useState<StatoAnalisi | null>(null)
    const [bozza, setBozza] = useState<RisultatoAnalisi | null>(null)
    const [lavoro, setLavoro] = useState<string | null>(null)
    const [errore, setErrore] = useState<string | null>(null)
    const [erroriInvio, setErroriInvio] = useState<string[]>([])
    const [chiediEmail, setChiediEmail] = useState(false)
    const [emailPopup, setEmailPopup] = useState('')
    const [esitoInvio, setEsitoInvio] = useState<{ emailInviata: boolean; erroreEmail: string | null; notificaDr7: boolean; motiviRevisione: string[] } | null>(null)
    const timer = useRef<ReturnType<typeof setInterval> | null>(null)
    // Come CARGOS: i documenti che DR7 ha gia' (contratto, fatture, estratto
    // del gestionale) si allegano da soli dal noleggio dei danni/penali.
    const [noleggi, setNoleggi] = useState<Noleggio[] | null>(null)
    const [noleggioScelto, setNoleggioScelto] = useState<string | null>(null)
    const [esclusi, setEsclusi] = useState<Set<string>>(new Set())
    const [cercaNoleggio, setCercaNoleggio] = useState('')

    useEffect(() => {
        if (!open) return
        setFase('documenti'); setFiles([]); setAnalisiId(null); setStato(null); setBozza(null)
        setLavoro(null); setErrore(null); setErroriInvio([]); setChiediEmail(false); setEmailPopup(''); setEsitoInvio(null)
        setNoleggi(null); setNoleggioScelto(null); setEsclusi(new Set()); setCercaNoleggio('')
        let annullato = false
        authFetch('/.netlify/functions/emtn-pratica', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ azione: 'noleggi', clientId, bookingId }),
        }).then(r => r.json()).then((j: { noleggi?: Noleggio[]; suggerito?: string | null }) => {
            if (annullato) return
            setNoleggi(j.noleggi || [])
            setNoleggioScelto(j.suggerito || null)
        }).catch(() => { if (!annullato) setNoleggi([]) })
        return () => { annullato = true; if (timer.current) clearInterval(timer.current) }
    }, [open, clientId, bookingId])

    if (!open) return null

    async function chiama<T>(corpo: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T }> {
        const res = await authFetch('/.netlify/functions/emtn-pratica', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
        })
        const data = await res.json().catch(() => ({})) as T
        return { ok: res.ok, status: res.status, data }
    }

    function aggiungiFile(lista: FileList | null) {
        if (!lista) return
        const nuovi = Array.from(lista).filter(f => !files.some(x => x.name === f.name && x.size === f.size))
        setFiles(prev => [...prev, ...nuovi])
    }

    async function leggiStato(id: string) {
        const r = await chiama<StatoAnalisi & { error?: string }>({ azione: 'stato', analisiId: id })
        if (!r.ok) throw new Error(r.data.error || 'Stato non leggibile')
        setStato(r.data)
        if (r.data.stato === 'pronta' && r.data.risultato) {
            if (timer.current) clearInterval(timer.current)
            setBozza(r.data.risultato)
            setFase('revisione')
        } else if (r.data.stato === 'errore') {
            if (timer.current) clearInterval(timer.current)
            setErrore(r.data.errore || 'Analisi non riuscita')
            setFase('documenti')
        }
    }

    async function analizza() {
        if (files.length === 0 && !noleggioScelto) { setErrore('Scegli il noleggio o carica almeno un documento'); return }
        setErrore(null)
        try {
            let id = analisiId
            if (!id) {
                setLavoro('Apertura pratica…')
                const r = await chiama<{ analisiId?: string; error?: string }>({ azione: 'crea', clientId, posizioneId })
                if (!r.ok || !r.data.analisiId) throw new Error(r.data.error || 'Apertura pratica fallita')
                id = r.data.analisiId
                setAnalisiId(id)
            }
            if (noleggioScelto) {
                setLavoro('Documenti dal gestionale DR7…')
                const r = await chiama<{ allegati?: string[]; mancanti?: string[]; error?: string }>({ azione: 'allega_gestionale', analisiId: id, bookingId: noleggioScelto, escludi: [...esclusi] })
                if (!r.ok) throw new Error(r.data.error || 'Documenti del gestionale non allegati')
                if ((r.data.mancanti || []).length) toast.error(`Non allegati: ${r.data.mancanti!.join(' · ')}`, { duration: 8000 })
            }
            const giaCaricati = new Set((stato?.documenti || []).map(d => d.nome))
            for (let i = 0; i < files.length; i++) {
                const f = files[i]
                if (giaCaricati.has(f.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80))) continue
                setLavoro(`Caricamento ${i + 1}/${files.length}: ${f.name}`)
                const fd = new FormData()
                fd.append('document', f, f.name)
                const up = await authFetch(`/.netlify/functions/emtn-analisi-documento?analisiId=${encodeURIComponent(id)}`, { method: 'POST', body: fd })
                if (!up.ok && up.status !== 409) {
                    const t = await up.json().catch(() => ({})) as { error?: string }
                    throw new Error(`${f.name}: ${t.error || `errore ${up.status}`}`)
                }
            }
            setLavoro(null)
            setFase('analisi')
            await authFetch('/.netlify/functions/emtn-analisi-background', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analisiId: id }),
            })
            const idFisso = id
            if (timer.current) clearInterval(timer.current)
            timer.current = setInterval(() => { leggiStato(idFisso).catch(e => setErrore(e.message)) }, 3000)
        } catch (e) {
            setLavoro(null)
            setErrore(e instanceof Error ? e.message : 'Errore')
            setFase('documenti')
        }
    }

    // ── modifica della bozza ──
    function aggiornaEvento(i: number, p: Partial<EventoEMTN>) {
        setBozza(b => b ? { ...b, eventi: b.eventi.map((e, k) => k === i ? { ...e, ...p } : e) } : b)
    }
    function aggiornaDato(i: number, chiave: string, valore: string) {
        setBozza(b => b ? { ...b, eventi: b.eventi.map((e, k) => k === i ? { ...e, dati: { ...e.dati, [chiave]: valore === '' ? null : valore } } : e) } : b)
    }
    function aggiungiEventi(ids: string[]) {
        setBozza(b => {
            if (!b) return b
            const presenti = new Set(b.eventi.map(e => String(e.codice)))
            const nuovi = ids.filter(id => !presenti.has(id)).map(id => ({ codice: Number(id), stato: 'DA_VERIFICARE' as const, dati: {}, fonti: [] }))
            return { ...b, eventi: [...b.eventi, ...nuovi] }
        })
    }

    async function invia(email?: string) {
        if (!bozza || !analisiId) return
        setErroriInvio([]); setErrore(null); setLavoro('Invio in corso…')
        const r = await chiama<{ error?: string; errori?: string[]; serveEmail?: boolean; emailInviata?: boolean; erroreEmail?: string | null; notificaDr7?: boolean; motiviRevisione?: string[] }>({
            azione: 'invia', analisiId, risultato: bozza, emailCliente: email || undefined,
        })
        setLavoro(null)
        if (r.status === 409 && r.data.serveEmail) { setChiediEmail(true); return }
        if (!r.ok) { setErroriInvio(r.data.errori || []); setErrore(r.data.error || 'Invio non riuscito'); return }
        setChiediEmail(false)
        setEsitoInvio({ emailInviata: !!r.data.emailInviata, erroreEmail: r.data.erroreEmail || null, notificaDr7: !!r.data.notificaDr7, motiviRevisione: r.data.motiviRevisione || [] })
        setFase('inviata')
        toast.success('Segnalazione inviata in approvazione')
        onInviata()
    }

    // Controlli dal vivo sulla bozza modificata (gli stessi che fara' il server).
    const verifica = bozza ? normalizzaRisultato(bozza) : null
    const motivi = verifica ? motiviRevisioneManuale(verifica.risultato, stato?.controlli_gestionale || []) : []

    return (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/50 p-2 sm:p-4 overflow-y-auto" onClick={onClose}>
            <div className="w-full max-w-4xl my-4 rounded-2xl border border-theme-border bg-theme-bg-secondary shadow-xl flex flex-col max-h-[calc(100vh-2rem)]" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-3 border-b border-theme-border">
                    <div>
                        <h3 className="text-lg font-bold text-theme-text-primary">{posizioneId ? 'Aggiorna posizione EMTN' : 'Segnalazione EMTN'}</h3>
                        <p className="text-xs text-theme-text-muted mt-0.5">{nomeCliente} · {fase === 'documenti' ? '1. Documenti' : fase === 'analisi' ? '2. Analisi AI' : fase === 'revisione' ? '3. Verifica e invio' : 'Inviata in approvazione'}</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Chiudi" className="p-1.5 rounded-lg text-theme-text-muted hover:bg-theme-bg-hover">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="px-5 sm:px-6 py-4 overflow-y-auto space-y-4">
                    {errore && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{errore}</div>}
                    {erroriInvio.length > 0 && (
                        <ul className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300 list-disc pl-6 space-y-0.5">
                            {erroriInvio.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    )}

                    {fase === 'documenti' && (
                        <>
                            {contesto && <p className="rounded-lg border border-theme-border bg-theme-bg-primary px-3 py-2 text-xs text-theme-text-secondary">{contesto}</p>}
                            <section>
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Noleggio dei danni / penali</h4>
                                <p className="text-[11px] text-theme-text-muted mb-2">I documenti che DR7 ha gia' su questo noleggio vengono allegati da soli: niente da caricare.</p>
                                {noleggi === null && <p className="text-xs text-theme-text-muted">Ricerca dei noleggi del cliente…</p>}
                                {noleggi && noleggi.length === 0 && <p className="text-xs text-theme-text-muted">Nessun noleggio DR7 trovato per questo cliente: carica i documenti qui sotto.</p>}
                                {noleggi && noleggi.length > 0 && (
                                    <BarraRicerca
                                        variante="compatta"
                                        className="w-full mb-2"
                                        value={cercaNoleggio}
                                        onChange={setCercaNoleggio}
                                        placeholder="Cerca: targa, n. contratto, veicolo, data noleggio (gg/mm/aaaa o mese), danno, penale, codice DR7…"
                                    />
                                )}
                                {noleggi && noleggi.length > 0 && (
                                    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                                        {[...noleggi].filter(n => {
                                            const q = cercaNoleggio.trim()
                                            if (!q || n.id === noleggioScelto) return true
                                            return corrispondeRicerca(q, [
                                                n.veicolo, n.targa, n.contratto, giorno(n.ritiro), giorno(n.riconsegna), `DR7-${n.id.slice(0, 8)}`,
                                                n.ritiro ? new Date(n.ritiro).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', month: 'long', year: 'numeric' }) : '',
                                                n.insoluto > 0 ? 'insoluto da saldare' : '',
                                                ...n.danni.map(v => v.label), ...n.penali.map(v => v.label),
                                                n.danni.length ? 'danno' : '', n.penali.length ? 'penale' : '', n.non_pagato > 0 ? 'non pagato' : '',
                                            ])
                                        }).sort((a, b) => Number(b.danni.length + b.penali.length > 0) - Number(a.danni.length + a.penali.length > 0)).map(n => {
                                            const scelto = n.id === noleggioScelto
                                            const voci = [...n.danni.map(v => ({ ...v, tipo: 'Danno' })), ...n.penali.map(v => ({ ...v, tipo: 'Penale' }))]
                                            return (
                                                <div key={n.id} onClick={() => { if (!scelto) { setNoleggioScelto(n.id); setEsclusi(new Set()) } }}
                                                    className={`block rounded-lg border px-3 py-2 cursor-pointer ${scelto ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border bg-theme-bg-primary hover:border-theme-text-muted'}`}>
                                                    <div className="flex items-start gap-2">
                                                        <input type="radio" name="noleggio-emtn" checked={scelto} readOnly className="mt-0.5" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-semibold text-theme-text-primary">
                                                                {n.veicolo || 'Veicolo n/d'} {n.targa ? `· ${n.targa}` : ''} <span className="font-normal text-theme-text-muted">· {giorno(n.ritiro)} → {giorno(n.riconsegna)} · {n.contratto ? `Contratto ${n.contratto}` : 'nessun contratto'} · DR7-{n.id.slice(0, 8).toUpperCase()}</span>
                                                            </p>
                                                            {voci.length > 0 ? (
                                                                <p className="text-[11px] text-theme-text-secondary">
                                                                    {voci.map(v => `${v.tipo} ${v.label} ${eur(v.importo)}${v.pagato ? ' (pagato)' : ''}`).join(' · ')}
                                                                    {n.non_pagato > 0 && <span className="text-red-600 dark:text-red-400 font-semibold"> · non pagato {eur(n.non_pagato)}</span>}
                                                                </p>
                                                            ) : <p className="text-[11px] text-theme-text-muted">Nessun danno o penale registrato</p>}
                                                            {n.insoluto > 0 && <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold">Noleggio da saldare: {eur(n.insoluto)}</p>}
                                                            {scelto && (
                                                                <div className="mt-1.5 space-y-0.5">
                                                                    {(n.documenti || [{ nome: 'contratto', tipo: 'contratto', descrizione: 'Contratto' }, { nome: 'fatture', tipo: 'fattura', descrizione: 'Fatture' }, { nome: 'estratto', tipo: 'estratto', descrizione: 'Estratto del gestionale' }]).map(d => (
                                                                        <label key={d.nome} className="flex items-center gap-2 text-[11px] text-theme-text-primary" onClick={e => e.stopPropagation()}>
                                                                            <input type="checkbox" checked={!esclusi.has(d.nome)} disabled={!n.documenti}
                                                                                onChange={() => setEsclusi(prev => { const x = new Set(prev); if (x.has(d.nome)) x.delete(d.nome); else x.add(d.nome); return x })} />
                                                                            {d.descrizione}
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </section>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted">Altri documenti (facoltativo)</p>
                            <div className="flex flex-wrap gap-1.5">
                                {DOCUMENTI_SUGGERITI.map(d => <span key={d} className="rounded-full border border-theme-border px-2 py-0.5 text-[10px] text-theme-text-muted">{d}</span>)}
                            </div>
                            <label
                                onDragOver={e => e.preventDefault()}
                                onDrop={e => { e.preventDefault(); aggiungiFile(e.dataTransfer.files) }}
                                className="block rounded-xl border-2 border-dashed border-theme-border bg-theme-bg-primary px-4 py-6 text-center cursor-pointer hover:border-dr7-gold/60"
                            >
                                <input type="file" multiple accept={ACCETTATI} className="hidden" onChange={e => { aggiungiFile(e.target.files); e.target.value = '' }} />
                                <span className="block text-sm font-medium text-theme-text-primary">Aggiungi documenti (verbali, foto, preventivi, comunicazioni…)</span>
                                <span className="block text-[11px] text-theme-text-muted">PDF, JPG, PNG o WEBP · max 10 MB ciascuno</span>
                            </label>
                            {files.length > 0 && (
                                <ul className="space-y-1">
                                    {files.map((f, i) => (
                                        <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-theme-border bg-theme-bg-primary px-3 py-1.5 text-xs">
                                            <span className="truncate text-theme-text-primary">{f.name} <span className="text-theme-text-muted">· {(f.size / 1024 / 1024).toFixed(2)} MB</span></span>
                                            <button type="button" onClick={() => setFiles(prev => prev.filter((_, k) => k !== i))} className="text-theme-text-muted hover:text-red-400" aria-label={`Togli ${f.name}`}>×</button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}

                    {fase === 'analisi' && (
                        <div className="py-10 text-center">
                            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-theme-border border-t-dr7-gold" />
                            <p className="mt-3 text-sm text-theme-text-primary">Analisi dei documenti in corso…</p>
                            <p className="text-xs text-theme-text-muted">Lettura, classificazione, controllo di coerenza e confronto con il gestionale. Puo' richiedere qualche minuto.</p>
                        </div>
                    )}

                    {fase === 'revisione' && bozza && (
                        <>
                            <div className={`rounded-lg border px-3 py-2 text-xs ${esitoCls(motivi.length ? 'REVISIONE_MANUALE_OBBLIGATORIA' : bozza.esito_verifica)}`}>
                                <p className="font-bold">{(motivi.length ? 'REVISIONE_MANUALE_OBBLIGATORIA' : bozza.esito_verifica).replace(/_/g, ' ')}</p>
                                {motivi.length > 0 && <ul className="list-disc pl-5 mt-1 space-y-0.5">{motivi.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                                {motivi.length > 0 && <p className="mt-1 opacity-80">Puoi inviare comunque: la direzione EMTN vedra' questi motivi prima di decidere.</p>}
                            </div>

                            {(stato?.avvisi || []).length > 0 && (
                                <ul className="rounded-lg border border-theme-border bg-theme-bg-primary px-3 py-2 text-[11px] text-theme-text-secondary list-disc pl-6">
                                    {stato!.avvisi.map((a, i) => <li key={i}>{a}</li>)}
                                </ul>
                            )}

                            <section>
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Dati della pratica</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    {CAMPI_PRATICA.map(c => (
                                        <label key={c.chiave} className="block">
                                            <span className="block text-[10px] text-theme-text-muted mb-0.5">{c.label}</span>
                                            <input className={inputCls} value={bozza.pratica[c.chiave] ?? ''} placeholder={NON_RISULTA}
                                                onChange={e => setBozza(b => b ? { ...b, pratica: { ...b.pratica, [c.chiave]: e.target.value || null } } : b)} />
                                        </label>
                                    ))}
                                </div>
                            </section>

                            <section>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted">Eventi ({bozza.eventi.length})</h4>
                                    <div className="w-72 max-w-full">
                                        <SelettoreCategorieEMTN value={[]} onChange={aggiungiEventi} accento="gold" opzioni={OPZIONI_EMTN} segnaposto="Aggiungi eventi…" />
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    {bozza.eventi.map((ev, i) => (
                                        <div key={i} className="rounded-xl border border-theme-border bg-theme-bg-primary p-3">
                                            <div className="flex flex-wrap items-start gap-2">
                                                <div className="flex-1 min-w-[220px]">
                                                    <SelettoreCategorieEMTN value={[String(ev.codice)]} onChange={ids => ids[0] && aggiornaEvento(i, { codice: Number(ids[0]) })}
                                                        accento="gold" opzioni={OPZIONI_EMTN} multiplo={false} segnaposto="Categoria" />
                                                </div>
                                                <select className={`${inputCls} w-auto`} value={ev.stato} onChange={e => aggiornaEvento(i, { stato: e.target.value as EventoEMTN['stato'] })}>
                                                    {STATI_EMTN.map(s => <option key={s} value={s}>{etichettaStato(s)}</option>)}
                                                </select>
                                                <button type="button" onClick={() => setBozza(b => b ? { ...b, eventi: b.eventi.filter((_, k) => k !== i) } : b)}
                                                    className="px-2 py-1 rounded-lg text-xs text-theme-text-muted hover:text-red-400" aria-label="Togli evento">×</button>
                                            </div>
                                            <p className="text-[11px] text-theme-text-muted mt-1">{categoriaEMTN(ev.codice)?.descrizione}</p>
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                                                {CAMPI_EVENTO.map(c => (
                                                    <label key={c.chiave} className="block">
                                                        <span className="block text-[10px] text-theme-text-muted mb-0.5">{c.label}</span>
                                                        <input className={inputCls} value={ev.dati[c.chiave] == null ? '' : String(ev.dati[c.chiave])} placeholder={NON_RISULTA}
                                                            inputMode={c.tipo === 'importo' ? 'decimal' : undefined}
                                                            onChange={e => aggiornaDato(i, c.chiave, e.target.value)} />
                                                    </label>
                                                ))}
                                            </div>
                                            {ev.dati.ritardo && <p className="text-[11px] text-theme-text-secondary mt-2">Ritardo calcolato: <strong>{String(ev.dati.ritardo)}</strong></p>}
                                            {ev.fonti.length > 0 && <p className="text-[10px] text-theme-text-muted mt-1">Fonti: {ev.fonti.join(', ')}</p>}
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {bozza.incongruenze.length > 0 && (
                                <section className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                                    <h4 className="font-bold mb-1">Incongruenze tra documenti</h4>
                                    <ul className="list-disc pl-5 space-y-0.5">{bozza.incongruenze.map((x, i) => <li key={i}>{x}</li>)}</ul>
                                </section>
                            )}

                            {(stato?.controlli_gestionale || []).length > 0 && (
                                <section>
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Controllo con il gestionale</h4>
                                    <TabellaControlli controlli={stato!.controlli_gestionale} />
                                </section>
                            )}

                            <section className="space-y-2">
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted">Mobility Risk Report preliminare</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <input className={`${inputCls} sm:col-span-2`} value={bozza.titolo} onChange={e => setBozza(b => b ? { ...b, titolo: e.target.value } : b)} placeholder="Titolo" />
                                    <select className={inputCls} value={bozza.stato_posizione} onChange={e => setBozza(b => b ? { ...b, stato_posizione: e.target.value as RisultatoAnalisi['stato_posizione'] } : b)}>
                                        {STATI_EMTN.map(s => <option key={s} value={s}>{etichettaStato(s)}</option>)}
                                    </select>
                                </div>
                                <textarea className={`${inputCls} min-h-[140px]`} value={bozza.report} onChange={e => setBozza(b => b ? { ...b, report: e.target.value } : b)} />
                                {verifica && verifica.errori.length > 0 && (
                                    <ul className="text-[11px] text-red-600 dark:text-red-400 list-disc pl-5">{verifica.errori.map((e, i) => <li key={i}>{e}</li>)}</ul>
                                )}
                            </section>

                            {bozza.informazioni_legali.length > 0 && (
                                <section className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                                    <h4 className="font-bold">{AVVISO_LEGALE}</h4>
                                    <p className="opacity-80 mb-1">Separato dal report: non viene mai mostrato agli altri operatori EMTN.</p>
                                    <ul className="list-disc pl-5 space-y-0.5">{bozza.informazioni_legali.map((x, i) => <li key={i}>{x}</li>)}</ul>
                                </section>
                            )}

                            <section>
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Documenti utilizzati</h4>
                                <ul className="space-y-0.5 text-[11px] text-theme-text-secondary">
                                    {(stato?.documenti || []).map(d => {
                                        const tipo = bozza.documenti.find(x => x.nome === d.nome)?.tipo
                                        return <li key={d.sha256}>{d.nome} · {tipo ? TIPI_DOCUMENTO[tipo] : 'tipo non riconosciuto'} · <span className="font-mono text-theme-text-muted">{d.sha256.slice(0, 12)}</span></li>
                                    })}
                                </ul>
                            </section>
                        </>
                    )}

                    {fase === 'inviata' && esitoInvio && (
                        <div className="space-y-2 text-sm">
                            <p className="text-theme-text-primary font-semibold">Segnalazione inviata alla coda approvazioni EMTN.</p>
                            <p className={esitoInvio.emailInviata ? 'text-theme-text-secondary' : 'text-red-600 dark:text-red-400'}>
                                Email al cliente: {esitoInvio.emailInviata ? 'inviata' : `NON inviata (${esitoInvio.erroreEmail || 'errore'})`}
                            </p>
                            <p className="text-theme-text-secondary">Notifica a DR7 per approvazione: {esitoInvio.notificaDr7 ? 'inviata' : 'non inviata'}</p>
                            <p className="text-xs text-theme-text-muted">Non e' visibile alla rete fino all'approvazione della direzione EMTN.</p>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 px-5 sm:px-6 py-3 border-t border-theme-border">
                    {lavoro && <span className="mr-auto text-xs text-theme-text-muted">{lavoro}</span>}
                    {fase === 'documenti' && (
                        <button type="button" onClick={analizza} disabled={!!lavoro || (files.length === 0 && !noleggioScelto)}
                            className="px-4 py-2 rounded-lg bg-dr7-gold text-black text-sm font-semibold disabled:opacity-50">Analizza documenti</button>
                    )}
                    {fase === 'revisione' && (
                        <button type="button" onClick={() => invia()} disabled={!!lavoro || !!verifica?.errori.length}
                            className="px-4 py-2 rounded-lg bg-dr7-gold text-black text-sm font-semibold disabled:opacity-50">Invia per approvazione</button>
                    )}
                    {fase === 'inviata' && (
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-theme-border text-sm text-theme-text-primary">Chiudi</button>
                    )}
                </div>
            </div>

            {chiediEmail && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={e => { e.stopPropagation(); setChiediEmail(false) }}>
                    <div className="w-full max-w-sm rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h4 className="text-base font-bold text-theme-text-primary">Email del cliente</h4>
                        <p className="text-xs text-theme-text-muted mt-1 mb-3">Il cliente non ha un'email in scheda. Serve per inviargli la comunicazione EMTN prima della pubblicazione.</p>
                        <input type="email" autoFocus className={inputCls} value={emailPopup} onChange={e => setEmailPopup(e.target.value)} placeholder="nome@esempio.it"
                            onKeyDown={e => { if (e.key === 'Enter' && emailPopup.includes('@')) invia(emailPopup.trim()) }} />
                        <div className="flex justify-end gap-2 mt-4">
                            <button type="button" onClick={() => setChiediEmail(false)} className="px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-text-primary">Annulla</button>
                            <button type="button" onClick={() => invia(emailPopup.trim())} disabled={!emailPopup.includes('@') || !!lavoro}
                                className="px-3 py-1.5 rounded-lg bg-dr7-gold text-black text-xs font-semibold disabled:opacity-50">Invia</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export function TabellaControlli({ controlli }: { controlli: ControlloGestionale[] }) {
    const colore: Record<ControlloGestionale['esito'], string> = {
        ok: 'text-green-600 dark:text-green-400', diverso: 'text-red-600 dark:text-red-400', non_trovato: 'text-amber-600 dark:text-amber-400', info: 'text-theme-text-muted',
    }
    const nome: Record<ControlloGestionale['esito'], string> = { ok: 'OK', diverso: 'DIVERSO', non_trovato: 'NON TROVATO', info: 'INFO' }
    return (
        <div className="overflow-x-auto rounded-lg border border-theme-border">
            <table className="w-full text-[11px]">
                <thead className="bg-theme-bg-tertiary text-theme-text-muted">
                    <tr><th className="text-left px-2 py-1">Controllo</th><th className="text-left px-2 py-1">Esito</th><th className="text-left px-2 py-1">Documento</th><th className="text-left px-2 py-1">Gestionale</th></tr>
                </thead>
                <tbody>
                    {controlli.map((c, i) => (
                        <tr key={i} className="border-t border-theme-border">
                            <td className="px-2 py-1 text-theme-text-primary">{c.controllo}</td>
                            <td className={`px-2 py-1 font-semibold ${colore[c.esito]}`}>{nome[c.esito]}</td>
                            <td className="px-2 py-1 text-theme-text-secondary">{c.documento || '—'}</td>
                            <td className="px-2 py-1 text-theme-text-secondary">{c.gestionale || '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
