import { useEffect, useState, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../supabaseClient'
import { useAdminRole } from '../../../../hooks/useAdminRole'
import Button from '../Button'
import FornitoreForm from './FornitoreForm'
import FornitoreDocumentUpload from './FornitoreDocumentUpload'
import FornitoreBollaUpload from './FornitoreBollaUpload'
import LimitationOverrideModal from '../../../../components/LimitationOverrideModal'
import { runCrosscheck, applyCrosscheckToFatture } from './FornitoreCrosscheck'
import {
    MESI_IT,
    fmtEUR,
    fmtDateIT,
} from './types'
import type { Fornitore, FornitoreDocument, CrosscheckRow } from './types'

interface Props {
    fornitore: Fornitore
    onBack: () => void
}

/**
 * Simple 4-step flow for a single fornitore.
 * 1. Carica bolle  2. Controllo incrociato  3. Approvazione (admin)  4. Pagamento (admin)
 *
 * No tabs, no marketing copy. Each step is a card. Admin-only steps are
 * disabled (with "Solo amministratore" badge) for non-superadmins.
 */
export default function FornitoreSimpleView({ fornitore, onBack }: Props) {
    const { canViewFinancials, adminName, adminEmail } = useAdminRole()
    const today = new Date()

    // Step 3 (Approvazione) e Step 4 (Pagamento) sono riservati a Valerio e
    // Ilenia. canViewFinancials da solo non basta — deve essere accompagnato
    // dal nome admin che combacia con uno dei due.
    const adminTokens = ((adminName || '') + ' ' + (adminEmail || '')).toLowerCase()
    const isValerioOrIlenia = adminTokens.includes('valerio') || adminTokens.includes('ilenia')
    const isAuthorizedByRole = canViewFinancials && isValerioOrIlenia

    const [anno, setAnno] = useState(today.getFullYear())
    // Default "tutti i mesi" — il count nella lista mostra TUTTE le fatture
    // dell'anno; aprire il fornitore senza vederle perche' il mese di default
    // era quello corrente confondeva gli admin. L'utente puo' restringere
    // tramite il selettore mese quando vuole.
    const [mese, setMese] = useState<number | 'tutti'>('tutti')
    const [docs, setDocs] = useState<FornitoreDocument[]>([])
    const [crosscheck, setCrosscheck] = useState<Map<number, CrosscheckRow[]>>(new Map())
    const [, setLoading] = useState(false)
    const [showUpload, setShowUpload] = useState(false)        // simple bolla upload (PDF only)
    // Per-row upload: when set, the upload modal opens pre-linked to this
    // fattura via fattura_collegata_id, so the controllo incrociato can
    // match per-fattura instead of relying on the same-month bulk dump.
    const [uploadForFatturaId, setUploadForFatturaId] = useState<string | null>(null)
    const [showManualEntry, setShowManualEntry] = useState(false)  // full form for new doc, no file required
    const [editingDoc, setEditingDoc] = useState<FornitoreDocument | null>(null)  // edit modal for existing docs
    const [editingAnagrafica, setEditingAnagrafica] = useState(false)  // edit modal for fornitore anagrafica (categoria, piva, etc.)
    const [currentFornitore, setCurrentFornitore] = useState<Fornitore>(fornitore)
    const [paymentDoc, setPaymentDoc] = useState<FornitoreDocument | null>(null)
    const [crossCheckRunning, setCrossCheckRunning] = useState(false)
    const [otpUnlocked, setOtpUnlocked] = useState(false)
    const [otpOpen, setOtpOpen] = useState(false)
    // draft_session_id deve essere UUID (constraint Postgres su limitation_overrides)
    const draftSessionId = useRef(crypto.randomUUID()).current

    // L'utente puo' usare step 3/4 se e' tra gli autorizzati di base oppure
    // se ha sbloccato la sessione tramite OTP override (verifica via mail).
    const canApproveAndPay = isAuthorizedByRole || otpUnlocked

    async function load() {
        setLoading(true)
        try {
            const { data } = await supabase
                .from('fornitore_documents')
                .select('*')
                .eq('fornitore_id', fornitore.id)
                .eq('periodo_anno', anno)
                .order('data_documento', { ascending: false })
            const rows = (data || []) as FornitoreDocument[]
            setDocs(rows)

            const map = new Map<number, CrosscheckRow[]>()
            for (let m = 1; m <= 12; m++) {
                const cc = await runCrosscheck(fornitore.id, anno, m)
                if (cc.length > 0) map.set(m, cc)
            }
            setCrosscheck(map)
        } catch (err) {
            console.error('[fornitore-simple] load error', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fornitore.id, anno])

    // Auto-sync fatture da Aruba quando si apre un fornitore (throttle 5 min per
    // non riscaricare ad ogni navigazione). Va fino a 12 mesi indietro per
    // coprire tutto il 2026 — i dati partono da 01/26.
    useEffect(() => {
        // Throttle 60 min — il cron notturno fornitori-fatture-sync-cron fa
        // il grosso del lavoro; questo qui e' un fallback se l'utente apre un
        // fornitore appena creato o se il cron non e' partito.
        const key = `dr7_fornitore_sync_${fornitore.id}`
        const last = parseInt(localStorage.getItem(key) || '0')
        if (Date.now() - last < 60 * 60 * 1000) return

        ;(async () => {
            try {
                // Auto-sync su mount: copertura 3 mesi per stare sotto i 26s
                // di timeout sync di Netlify. Lo scan completo (12 mesi) viene
                // fatto dal cron notturno fornitori-fatture-sync-background.
                const res = await fetch('/.netlify/functions/sync-fornitore-invoices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fornitore_id: fornitore.id, months: 3 }),
                })
                const json = await res.json()
                if (res.ok && json.success) {
                    localStorage.setItem(key, String(Date.now()))
                    if ((json.inserted || 0) > 0) await load()
                }
            } catch (err) {
                console.warn('[fornitore-simple] auto-sync fatture failed:', err)
            }
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fornitore.id])

    // Quando l'utente seleziona un mese specifico, filtriamo TUTTI i derivati
    // (bolle, fatture, daApprovare, daPagare, anomalie) su quel solo mese.
    const docsFiltered = useMemo(
        () => mese === 'tutti' ? docs : docs.filter(d => d.periodo_mese === mese),
        [docs, mese]
    )
    const bolle = useMemo(() => docsFiltered.filter(d => d.tipo === 'ddt' || d.tipo === 'bolla'), [docsFiltered])
    const fatture = useMemo(() => docsFiltered.filter(d => d.tipo === 'fattura'), [docsFiltered])
    const daApprovare = useMemo(
        () => fatture.filter(f => f.stato === 'verificato'),
        [fatture]
    )
    const daPagare = useMemo(
        () => fatture.filter(f => f.stato === 'approvato' || f.stato === 'pagabile'),
        [fatture]
    )

    const tutteAnomalie = useMemo(() => {
        const all: Array<CrosscheckRow & { mese: number }> = []
        crosscheck.forEach((rows, m) => {
            if (mese !== 'tutti' && m !== mese) return
            rows.forEach(r => {
                if (r.stato_calcolato === 'anomalia') all.push({ ...r, mese: m })
            })
        })
        return all
    }, [crosscheck, mese])

    const fatturaById = useMemo(() => {
        const m = new Map<string, FornitoreDocument>()
        for (const d of fatture) m.set(d.id, d)
        return m
    }, [fatture])

    const countOk = useMemo(() => {
        let n = 0
        crosscheck.forEach((rows, m) => {
            if (mese !== 'tutti' && m !== mese) return
            n += rows.filter(r => r.stato_calcolato === 'verificato').length
        })
        return n
    }, [crosscheck, mese])

    async function approveDoc(doc: FornitoreDocument) {
        const { error } = await supabase
            .from('fornitore_documents')
            .update({ stato: 'approvato' })
            .eq('id', doc.id)
        if (error) { alert('Errore: ' + error.message); return }
        load()
    }

    async function approveAll() {
        if (daApprovare.length === 0) return
        if (!confirm(`Approvare tutte e ${daApprovare.length} le fatture verificate?`)) return
        const ids = daApprovare.map(f => f.id)
        const { error } = await supabase
            .from('fornitore_documents')
            .update({ stato: 'approvato' })
            .in('id', ids)
        if (error) { alert('Errore: ' + error.message); return }
        load()
    }

    async function forceResyncFromAruba() {
        const key = `dr7_fornitore_sync_${fornitore.id}`
        localStorage.removeItem(key)
        const t = toast.loading('Sincronizzo fatture da Aruba…')
        try {
            const res = await fetch('/.netlify/functions/sync-fornitore-invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fornitore_id: fornitore.id, months: 12 }),
            })
            // Netlify gateway timeout / 5xx restituisce HTML, non JSON. Gestiamolo
            // con un messaggio chiaro invece di "Unexpected token <".
            const contentType = res.headers.get('content-type') || ''
            if (!contentType.includes('application/json')) {
                throw new Error(res.status === 504 || res.status === 502
                    ? 'Aruba ha impiegato troppo tempo. Riprova fra qualche minuto.'
                    : `Errore ${res.status}: server non ha restituito JSON`)
            }
            const json = await res.json()
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
            localStorage.setItem(key, String(Date.now()))
            await load()
            toast.success(`Trovate ${json.matched} fatture · ${json.inserted} nuove · ${json.skipped} già presenti`, { id: t })
        } catch (err) {
            toast.error('Sync fallita: ' + (err instanceof Error ? err.message : String(err)), { id: t })
        }
    }

    async function runManualCrossCheck() {
        setCrossCheckRunning(true)
        try {
            const map = new Map<number, CrosscheckRow[]>()
            let totalRows = 0
            let totalAnomalie = 0
            let totalOk = 0
            for (let m = 1; m <= 12; m++) {
                const cc = await runCrosscheck(fornitore.id, anno, m)
                if (cc.length > 0) {
                    map.set(m, cc)
                    totalRows += cc.length
                    totalAnomalie += cc.filter(r => r.stato_calcolato === 'anomalia').length
                    totalOk += cc.filter(r => r.stato_calcolato === 'verificato').length
                    await applyCrosscheckToFatture(cc, fatture, { fornitoreNome: fornitore.nome, anno, mese: m })
                }
            }
            setCrosscheck(map)
            await load()

            // Feedback esplicito — l'utente DEVE sapere cos'e' successo
            if (totalRows === 0) {
                if (fatture.length === 0) {
                    toast(`Nessuna fattura da controllare per il ${anno}.`, { icon: 'ℹ️' })
                } else {
                    toast(`${fatture.length} fattur${fatture.length === 1 ? 'a' : 'e'} ma nessuna ha importi da confrontare. Carica le bolle e l'AI estrarra' gli importi.`, { icon: 'ℹ️' })
                }
            } else if (totalAnomalie === 0) {
                toast.success(`Tutte le ${totalOk} fatture quadrano con le bolle.`)
            } else {
                toast.error(`Trovate ${totalAnomalie} anomali${totalAnomalie === 1 ? 'a' : 'e'} su ${totalRows} fatture.`)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error('Controllo fallito: ' + msg)
        } finally {
            setCrossCheckRunning(false)
        }
    }

    async function recordPayment(doc: FornitoreDocument, dataPag: string, metodo: string) {
        const { error } = await supabase
            .from('fornitore_documents')
            .update({ stato: 'pagato', data_pagamento: dataPag, metodo_pagamento: metodo })
            .eq('id', doc.id)
        if (error) { alert('Errore: ' + error.message); return }
        setPaymentDoc(null)
        load()
    }

    async function viewFile(doc: FornitoreDocument) {
        // Path 1 — file caricato manualmente: signed URL su Supabase storage
        if (doc.file_url) {
            const { data, error } = await supabase.storage
                .from('fornitori-documents')
                .createSignedUrl(doc.file_url, 60 * 5)
            if (!error && data?.signedUrl) {
                window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
                return
            }
        }
        // Path 2 — fattura importata da Aruba SDI: scarica via API Aruba E
        // cache la copia in Supabase storage cosi' le viste successive sono
        // istantanee (signed URL invece di chiamare di nuovo Aruba).
        if (doc.aruba_filename) {
            try {
                const res = await fetch(`/.netlify/functions/get-incoming-invoices?action=download&filename=${encodeURIComponent(doc.aruba_filename)}`)
                const json = await res.json()
                if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
                const data = json.invoice || {}
                const base64 = data.pdf || data.pdfFile
                if (!base64) {
                    alert('PDF non disponibile in Aruba per questa fattura.')
                    return
                }
                const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
                const blob = new Blob([bytes], { type: 'application/pdf' })

                // Apri subito il PDF
                const url = URL.createObjectURL(blob)
                window.open(url, '_blank', 'noopener,noreferrer')
                setTimeout(() => URL.revokeObjectURL(url), 60000)

                // In background: cache su Supabase storage cosi' le viste
                // successive saltano la chiamata a Aruba.
                ;(async () => {
                    try {
                        const dataDoc = doc.data_documento ? new Date(doc.data_documento) : new Date()
                        const yy = dataDoc.getFullYear()
                        const mm = String(dataDoc.getMonth() + 1).padStart(2, '0')
                        const safe = (doc.numero_documento || 'fattura').replace(/[^\w-]/g, '_')
                        const path = `fornitori/${doc.fornitore_id}/${yy}/${mm}/aruba-${safe}-${doc.id}.pdf`
                        const { error: upErr } = await supabase.storage
                            .from('fornitori-documents')
                            .upload(path, blob, { contentType: 'application/pdf', upsert: true })
                        if (!upErr) {
                            await supabase.from('fornitore_documents')
                                .update({ file_url: path, file_name: `${safe}.pdf` })
                                .eq('id', doc.id)
                            // Aggiorna lo state locale senza ri-render forzato
                            setDocs(prev => prev.map(d => d.id === doc.id
                                ? { ...d, file_url: path, file_name: `${safe}.pdf` }
                                : d))
                        }
                    } catch (e) {
                        console.warn('[viewFile] cache to storage failed:', e)
                    }
                })()
                return
            } catch (err) {
                alert('Download fallito: ' + (err instanceof Error ? err.message : String(err)))
                return
            }
        }
        alert('Nessun file disponibile per questa fattura.')
    }

    function canViewDoc(d: FornitoreDocument | undefined): boolean {
        return !!(d && (d.file_url || d.aruba_filename))
    }

    const annoOptions: number[] = []
    for (let y = today.getFullYear(); y >= 2026; y--) annoOptions.push(y)

    return (
        <div className="space-y-4">
            {/* Header — anagrafica essenziale */}
            <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border flex flex-wrap items-center justify-between gap-3">
                <div>
                    <button onClick={onBack} className="text-xs text-theme-text-muted hover:text-theme-text-primary">← Tutti i fornitori</button>
                    <h2 className="text-xl font-semibold text-theme-text-primary">{currentFornitore.nome}</h2>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-theme-text-secondary">
                        {currentFornitore.piva && <span>P.IVA {currentFornitore.piva}</span>}
                        {currentFornitore.categoria_merce
                            ? <span className="px-2 py-0.5 rounded bg-dr7-gold/15 text-dr7-gold border border-dr7-gold/30">{currentFornitore.categoria_merce}</span>
                            : <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">Senza categoria</span>}
                        {currentFornitore.condizioni_pagamento && <span>{currentFornitore.condizioni_pagamento}</span>}
                        {currentFornitore.email && <span>{currentFornitore.email}</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* 2026-07-13 FIX: mancava un pulsante per caricare una bolla/DDT
                        non legata a una fattura specifica (setShowUpload non era mai
                        richiamato) → l'utente non trovava come inserire le bolle.
                        Ora c'è un pulsante ben visibile. */}
                    <button
                        onClick={() => { setUploadForFatturaId(null); setShowUpload(true) }}
                        className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                        title="Carica una bolla / DDT per questo fornitore"
                    >
                        + Carica Bolla / DDT
                    </button>
                    <button
                        onClick={() => setEditingAnagrafica(true)}
                        className="text-xs px-3 py-1.5 rounded bg-dr7-gold/20 hover:bg-dr7-gold/30 text-dr7-gold border border-dr7-gold/30 font-semibold"
                        title="Modifica anagrafica (categoria, P.IVA, condizioni…)"
                    >
                        Modifica anagrafica
                    </button>
                    <button
                        onClick={forceResyncFromAruba}
                        className="text-xs px-3 py-1.5 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary border border-theme-border"
                        title="Forza sincronizzazione fatture da Aruba (ultimi 24 mesi)"
                    >
                        Aggiorna fatture
                    </button>
                    <select value={mese} onChange={e => setMese(e.target.value === 'tutti' ? 'tutti' : parseInt(e.target.value))}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
                        <option value="tutti">Tutti i mesi</option>
                        {MESI_IT.map((label, idx) => (
                            <option key={idx} value={idx + 1}>{label}</option>
                        ))}
                    </select>
                    <select value={anno} onChange={e => setAnno(parseInt(e.target.value))}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
                        {annoOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>

            {/* Fatture del periodo — ogni riga ha il suo "+ Carica documento"
                che apre il modal pre-linkato alla fattura tramite
                fattura_collegata_id. Niente piu' bulk-upload mensile. */}
            <Step title="Fatture del periodo" desc={`${fatture.length} fattur${fatture.length === 1 ? 'a' : 'e'} · ${fmtEUR(fatture.reduce((s, f) => s + Number(f.importo_totale || 0), 0))} totale`}>
                {fatture.length === 0 ? (
                    <p className="text-sm text-theme-text-muted">Nessuna fattura per questo periodo.</p>
                ) : (
                    <ul className="space-y-1">
                        {fatture.map(f => {
                            const linkedBolle = bolle.filter(b => b.fattura_collegata_id === f.id)
                            const linkedTotal = linkedBolle.reduce((s, b) => s + Number(b.importo_totale || 0), 0)
                            const fAmount = Number(f.importo_totale || 0)
                            const delta = fAmount - linkedTotal
                            const matched = linkedBolle.length > 0 && Math.abs(delta) < 0.01
                            return (
                                <li key={f.id} className="text-sm flex flex-wrap items-center gap-3 px-3 py-2 rounded bg-theme-bg-tertiary/50">
                                    <span className="font-mono">{f.numero_documento}</span>
                                    <span className="text-xs text-theme-text-muted">{fmtDateIT(f.data_documento)}</span>
                                    <span className="ml-auto">Fattura: <strong>{fmtEUR(fAmount)}</strong></span>
                                    <span className="text-theme-text-muted">Bolle ({linkedBolle.length}): <strong>{fmtEUR(linkedTotal)}</strong></span>
                                    {linkedBolle.length > 0 && (
                                        <span className={`text-xs px-2 py-0.5 rounded ${matched ? 'bg-emerald-700/30 text-emerald-300' : 'bg-amber-700/30 text-amber-300'}`}>
                                            Δ {fmtEUR(delta)}
                                        </span>
                                    )}
                                    <button
                                        onClick={() => setUploadForFatturaId(f.id)}
                                        className="text-xs px-2 py-1 rounded bg-dr7-gold text-black font-semibold hover:opacity-90"
                                    >
                                        + Carica documento
                                    </button>
                                    {canViewDoc(f) && (
                                        <button onClick={() => viewFile(f)}
                                            className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary">
                                            Vedi fattura
                                        </button>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </Step>

            {/* Controllo incrociato */}
            <Step title="Controllo incrociato"
                desc={tutteAnomalie.length > 0
                    ? `${tutteAnomalie.length} anomali${tutteAnomalie.length === 1 ? 'a' : 'e'} · ${countOk} fatture OK`
                    : `${countOk} fatture verificate ${countOk > 0 ? '✓' : ''}`}
                tone={tutteAnomalie.length > 0 ? 'warning' : 'ok'}>
                <div className="flex justify-end mb-3">
                    <Button onClick={runManualCrossCheck} disabled={crossCheckRunning}>
                        {crossCheckRunning ? 'Analisi in corso…' : 'Esegui controllo incrociato'}
                    </Button>
                </div>
                {tutteAnomalie.length === 0 && countOk === 0 && (
                    <p className="text-sm text-theme-text-muted">Le fatture verranno confrontate con le bolle dello stesso mese. Premi "Esegui controllo incrociato" per analizzare ora.</p>
                )}
                {tutteAnomalie.length > 0 && (
                    <div className="space-y-1">
                        {tutteAnomalie.map(a => {
                            const fattura = fatturaById.get(a.fattura_id)
                            return (
                                <div key={a.fattura_id} className="text-sm px-3 py-2 rounded bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 flex flex-wrap items-center gap-3 text-orange-900 dark:text-orange-100">
                                    <span>⚠</span>
                                    <span className="font-mono font-semibold">{a.fattura_numero}</span>
                                    <span className="opacity-70">— {MESI_IT[a.mese - 1]} {anno}</span>
                                    <span className="ml-auto">Fattura: <strong>{fmtEUR(a.fattura_totale)}</strong></span>
                                    <span>Bolle: <strong>{fmtEUR(a.ddt_totale)}</strong></span>
                                    <span className="font-bold">Δ {fmtEUR(a.differenza)}</span>
                                    {canViewDoc(fattura) && (
                                        <button onClick={() => fattura && viewFile(fattura)}
                                            className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                                            Vedi fattura
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </Step>

            {/* Approvazione */}
            <Step title="Approvazione" desc={`${daApprovare.length} fattur${daApprovare.length === 1 ? 'a' : 'e'} da approvare`}
                locked={!canApproveAndPay}
                lockedAction={!canApproveAndPay && (
                    <button onClick={() => setOtpOpen(true)}
                        className="text-xs px-3 py-1.5 rounded bg-dr7-gold text-black font-semibold hover:opacity-90">
                        Richiedi accesso OTP
                    </button>
                )}>
                {daApprovare.length === 0 ? (
                    <p className="text-sm text-theme-text-muted">Nessuna fattura verificata in attesa.</p>
                ) : (
                    <>
                        {canApproveAndPay && (
                            <div className="flex justify-end mb-2">
                                <Button onClick={approveAll}>Approva tutte ({daApprovare.length})</Button>
                            </div>
                        )}
                        <ul className="space-y-1">
                            {daApprovare.map(f => (
                                <li key={f.id} className="text-sm flex items-center gap-3 px-3 py-2 rounded bg-theme-bg-tertiary/50">
                                    <span className="font-mono">{f.numero_documento}</span>
                                    <span className="text-theme-text-muted text-xs">{fmtDateIT(f.data_documento)}</span>
                                    <span className="ml-auto font-semibold">{fmtEUR(f.importo_totale)}</span>
                                    {canApproveAndPay && canViewDoc(f) && (
                                        <button onClick={() => viewFile(f)}
                                            className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary">
                                            Vedi
                                        </button>
                                    )}
                                    {canApproveAndPay && (
                                        <button onClick={() => approveDoc(f)} className="text-xs px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white">
                                            Approva
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </Step>

            {/* Pagamento */}
            <Step title="Pagamento" desc={`${daPagare.length} fattur${daPagare.length === 1 ? 'a' : 'e'} da pagare`}
                locked={!canApproveAndPay}
                lockedAction={!canApproveAndPay && (
                    <button onClick={() => setOtpOpen(true)}
                        className="text-xs px-3 py-1.5 rounded bg-dr7-gold text-black font-semibold hover:opacity-90">
                        Richiedi accesso OTP
                    </button>
                )}>
                {daPagare.length === 0 ? (
                    <p className="text-sm text-theme-text-muted">Nessuna fattura approvata in attesa di pagamento.</p>
                ) : (
                    <ul className="space-y-1">
                        {daPagare.map(f => (
                            <li key={f.id} className="text-sm flex flex-wrap items-center gap-3 px-3 py-2 rounded bg-theme-bg-tertiary/50">
                                <span className="font-mono">{f.numero_documento}</span>
                                <span className="text-theme-text-muted text-xs">{fmtDateIT(f.data_documento)}</span>
                                {f.data_scadenza && <span className="text-xs text-amber-300">scade {fmtDateIT(f.data_scadenza)}</span>}
                                <span className="ml-auto font-semibold">{fmtEUR(f.importo_totale)}</span>
                                {canApproveAndPay && canViewDoc(f) && (
                                    <button onClick={() => viewFile(f)}
                                        className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary">
                                        Vedi
                                    </button>
                                )}
                                {canApproveAndPay && (
                                    <button onClick={() => setPaymentDoc(f)} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white">
                                        Registra pagamento
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Step>

            {(showUpload || uploadForFatturaId) && (
                <FornitoreBollaUpload
                    fornitore={fornitore}
                    fatturaId={uploadForFatturaId || undefined}
                    onClose={() => { setShowUpload(false); setUploadForFatturaId(null) }}
                    onManualEntry={() => { setShowUpload(false); setUploadForFatturaId(null); setShowManualEntry(true) }}
                    onSaved={async (opts) => {
                        setShowUpload(false)
                        setUploadForFatturaId(null)
                        await load()
                        if (opts?.triggerCompare) {
                            // Piccolo delay per dare tempo all'AI di estrarre gli importi
                            // dei nuovi documenti prima del controllo incrociato.
                            await new Promise(r => setTimeout(r, 800))
                            await runManualCrossCheck()
                        }
                    }}
                />
            )}

            {showManualEntry && (
                <FornitoreDocumentUpload
                    fornitore={fornitore}
                    onClose={() => setShowManualEntry(false)}
                    onSaved={() => { setShowManualEntry(false); load() }}
                />
            )}

            {editingDoc && (
                <FornitoreDocumentUpload
                    fornitore={fornitore}
                    document={editingDoc}
                    onClose={() => setEditingDoc(null)}
                    onSaved={() => { setEditingDoc(null); load() }}
                />
            )}

            {paymentDoc && (
                <PaymentModal doc={paymentDoc} onClose={() => setPaymentDoc(null)} onConfirm={recordPayment} />
            )}

            {editingAnagrafica && (
                <FornitoreForm
                    fornitore={currentFornitore}
                    onClose={() => setEditingAnagrafica(false)}
                    onSaved={(f) => { setCurrentFornitore(f); setEditingAnagrafica(false) }}
                />
            )}

            <LimitationOverrideModal
                isOpen={otpOpen}
                limitationCode="fornitore_admin_action"
                limitationMessage="Approvazione e pagamento fatture fornitore"
                actionContext={`fornitore_${fornitore.id}`}
                draftSessionId={draftSessionId}
                flowType="fornitori"
                details={(() => {
                    const totApprovare = daApprovare.reduce((s, f) => s + Number(f.importo_totale || 0), 0)
                    const totPagare = daPagare.reduce((s, f) => s + Number(f.importo_totale || 0), 0)
                    const d: Record<string, string | number> = {
                        'Fornitore': fornitore.nome,
                    }
                    if (fornitore.piva) d['P.IVA'] = fornitore.piva
                    d['Anno fiscale'] = anno
                    d['Mese'] = mese !== 'tutti' ? MESI_IT[mese - 1] : 'Tutti i mesi'
                    d['Fatture da approvare'] = daApprovare.length
                    d['Fatture da pagare'] = daPagare.length
                    d['Anomalie'] = tutteAnomalie.length
                    d['Importo da approvare'] = fmtEUR(totApprovare)
                    d['Importo da pagare'] = fmtEUR(totPagare)
                    d['Operazione'] = 'Sblocca approvazione e pagamento fatture fornitore'
                    return d
                })()}
                onClose={() => setOtpOpen(false)}
                onCancel={() => setOtpOpen(false)}
                onOverrideApproved={() => {
                    setOtpUnlocked(true)
                    setOtpOpen(false)
                }}
            />
        </div>
    )
}

function Step({ title, desc, tone, locked, lockedAction, children }: {
    title: string
    desc: string
    tone?: 'ok' | 'warning'
    locked?: boolean
    lockedAction?: React.ReactNode
    children: React.ReactNode
}) {
    const toneCls = tone === 'warning' ? 'bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-800'
        : tone === 'ok' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800'
        : 'bg-theme-bg-secondary border-theme-border'
    return (
        <div className={`rounded-lg border p-4 relative ${locked ? 'border-theme-border bg-theme-bg-tertiary/40' : toneCls}`}>
            <div className="flex items-center gap-3 mb-3">
                {locked && (
                    <span className="flex-shrink-0 w-8 h-8 rounded-full font-bold flex items-center justify-center bg-theme-bg-tertiary text-theme-text-muted">
                        🔒
                    </span>
                )}
                <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${locked ? 'text-theme-text-muted' : 'text-theme-text-primary'}`}>{title}</p>
                    <p className="text-xs text-theme-text-muted">{desc}</p>
                </div>
                {locked && lockedAction}
            </div>
            <div className={locked ? 'opacity-50 pointer-events-none select-none' : ''}>
                {children}
            </div>
        </div>
    )
}

function PaymentModal({ doc, onClose, onConfirm }: {
    doc: FornitoreDocument
    onClose: () => void
    onConfirm: (doc: FornitoreDocument, dataPag: string, metodo: string) => Promise<void>
}) {
    const [dataPag, setDataPag] = useState(new Date().toISOString().slice(0, 10))
    const [metodo, setMetodo] = useState('bonifico')
    const [submitting, setSubmitting] = useState(false)

    async function handleSubmit() {
        setSubmitting(true)
        try {
            await onConfirm(doc, dataPag, metodo)
        } finally { setSubmitting(false) }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-theme-text-primary mb-3">Registra pagamento</h3>
                <p className="text-sm text-theme-text-secondary mb-4">
                    Fattura n.{doc.numero_documento} — {fmtEUR(doc.importo_totale)}
                </p>
                <label className="block mb-3 text-sm">
                    <span className="text-theme-text-secondary">Data pagamento</span>
                    <input type="date" value={dataPag} onChange={e => setDataPag(e.target.value)}
                        className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                </label>
                <label className="block mb-4 text-sm">
                    <span className="text-theme-text-secondary">Metodo</span>
                    <select value={metodo} onChange={e => setMetodo(e.target.value)}
                        className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary">
                        <option value="bonifico">Bonifico</option>
                        <option value="contanti">Contanti</option>
                        <option value="rid_sdd">RID / SDD</option>
                        <option value="carta">Carta</option>
                        <option value="altro">Altro</option>
                    </select>
                </label>
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary">Annulla</button>
                    <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Salvataggio…' : 'Conferma pagamento'}</Button>
                </div>
            </div>
        </div>
    )
}
