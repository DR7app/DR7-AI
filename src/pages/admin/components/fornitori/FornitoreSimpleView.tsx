import { useEffect, useState, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../supabaseClient'
import { useAdminRole } from '../../../../hooks/useAdminRole'
import Button from '../Button'
import FornitoreDocumentUpload from './FornitoreDocumentUpload'
import FornitoreBollaUpload from './FornitoreBollaUpload'
import LimitationOverrideModal from '../../../../components/LimitationOverrideModal'
import { runCrosscheck, applyCrosscheckToFatture } from './FornitoreCrosscheck'
import {
    DOCUMENT_TIPO_LABELS,
    DOCUMENT_STATO_LABELS,
    DOCUMENT_STATO_COLORS,
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
    const [loading, setLoading] = useState(false)
    const [showUpload, setShowUpload] = useState(false)        // simple bolla upload (PDF only)
    const [showManualEntry, setShowManualEntry] = useState(false)  // full form for new doc, no file required
    const [editingDoc, setEditingDoc] = useState<FornitoreDocument | null>(null)  // edit modal for existing docs
    const [paymentDoc, setPaymentDoc] = useState<FornitoreDocument | null>(null)
    const [crossCheckRunning, setCrossCheckRunning] = useState(false)
    const [otpUnlocked, setOtpUnlocked] = useState(false)
    const [otpOpen, setOtpOpen] = useState(false)
    const draftSessionId = useRef(`fornitori-${fornitore.id}-${Date.now()}`).current

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
                const res = await fetch('/.netlify/functions/sync-fornitore-invoices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fornitore_id: fornitore.id, months: 12 }),
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
                    await applyCrosscheckToFatture(cc, fatture)
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

    async function deleteDoc(doc: FornitoreDocument) {
        if (!confirm(`Eliminare definitivamente questo documento (${doc.numero_documento})?`)) return
        try {
            if (doc.file_url) {
                await supabase.storage.from('fornitori-documents').remove([doc.file_url])
            }
            const { error } = await supabase.from('fornitore_documents').delete().eq('id', doc.id)
            if (error) throw error
            load()
        } catch (err) {
            alert('Errore: ' + (err instanceof Error ? err.message : String(err)))
        }
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
                    <h2 className="text-xl font-semibold text-theme-text-primary">{fornitore.nome}</h2>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-theme-text-secondary">
                        {fornitore.piva && <span>P.IVA {fornitore.piva}</span>}
                        {fornitore.condizioni_pagamento && <span>{fornitore.condizioni_pagamento}</span>}
                        {fornitore.email && <span>{fornitore.email}</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
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

            {/* STEP 1 — Carica bolle */}
            <Step n={1} title="Carica bolle" desc={`${bolle.length} caricate · ${fmtEUR(bolle.reduce((s, b) => s + Number(b.importo_totale || 0), 0))} totale`}>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <Button onClick={() => setShowUpload(true)}>+ Carica documento</Button>
                    {loading && <span className="text-xs text-theme-text-muted">Caricamento…</span>}
                </div>
                <CompactDocList docs={bolle.slice(0, 10)} viewFile={viewFile}
                    onEdit={(d) => setEditingDoc(d)}
                    onDelete={deleteDoc} />
                {bolle.length > 10 && <p className="text-xs text-theme-text-muted mt-2">… e altre {bolle.length - 10} bolle</p>}
            </Step>

            {/* STEP 2 — Controllo incrociato */}
            <Step n={2} title="Controllo incrociato"
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

            {/* STEP 3 — Approvazione */}
            <Step n={3} title="Approvazione" desc={`${daApprovare.length} fattur${daApprovare.length === 1 ? 'a' : 'e'} da approvare`}
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

            {/* STEP 4 — Pagamento */}
            <Step n={4} title="Pagamento" desc={`${daPagare.length} fattur${daPagare.length === 1 ? 'a' : 'e'} da pagare`}
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

            {showUpload && (
                <FornitoreBollaUpload
                    fornitore={fornitore}
                    onClose={() => setShowUpload(false)}
                    onManualEntry={() => { setShowUpload(false); setShowManualEntry(true) }}
                    onSaved={async (opts) => {
                        setShowUpload(false)
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

            <LimitationOverrideModal
                isOpen={otpOpen}
                limitationCode="fornitore_admin_action"
                limitationMessage="Approvazione e pagamento fatture fornitore"
                actionContext={`fornitore_${fornitore.id}`}
                draftSessionId={draftSessionId}
                flowType="fornitori"
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

function Step({ n, title, desc, tone, locked, lockedAction, children }: {
    n: number
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
                <span className={`flex-shrink-0 w-8 h-8 rounded-full font-bold flex items-center justify-center ${locked ? 'bg-theme-bg-tertiary text-theme-text-muted' : 'bg-dr7-gold text-black'}`}>
                    {locked ? '🔒' : n}
                </span>
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

function CompactDocList({ docs, viewFile, onEdit, onDelete }: {
    docs: FornitoreDocument[]
    viewFile: (d: FornitoreDocument) => void
    onEdit: (d: FornitoreDocument) => void
    onDelete: (d: FornitoreDocument) => void
}) {
    if (docs.length === 0) {
        return <p className="text-sm text-theme-text-muted">Nessuna bolla per questo periodo.</p>
    }
    return (
        <ul className="space-y-1">
            {docs.map(d => (
                <li key={d.id} className="text-sm flex items-center gap-3 px-3 py-2 rounded bg-theme-bg-tertiary/50">
                    <span className="text-xs uppercase font-mono px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-secondary">{DOCUMENT_TIPO_LABELS[d.tipo]}</span>
                    <span className="font-mono text-xs">{d.numero_documento}</span>
                    <span className="text-xs text-theme-text-muted">{fmtDateIT(d.data_documento)}</span>
                    <span className="ml-auto font-semibold">{fmtEUR(d.importo_totale)}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${DOCUMENT_STATO_COLORS[d.stato]}`}>{DOCUMENT_STATO_LABELS[d.stato]}</span>
                    {d.file_url && (
                        <button onClick={() => viewFile(d)} className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary">
                            Vedi
                        </button>
                    )}
                    <button onClick={() => onEdit(d)} className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-tertiary/70 text-theme-text-primary">
                        Modifica
                    </button>
                    <button onClick={() => onDelete(d)} className="text-xs px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white" title="Elimina">
                        ×
                    </button>
                </li>
            ))}
        </ul>
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
