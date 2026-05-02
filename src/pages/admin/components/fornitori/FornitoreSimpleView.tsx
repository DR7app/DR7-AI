import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../../../../supabaseClient'
import { useAdminRole } from '../../../../hooks/useAdminRole'
import Button from '../Button'
import FornitoreDocumentUpload from './FornitoreDocumentUpload'
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
    // L'utente puo' usare step 3/4 se e' tra gli autorizzati di base oppure
    // se ha sbloccato la sessione tramite OTP override (verifica via mail).
    const canApproveAndPay = isAuthorizedByRole || otpUnlocked
    const [anno, setAnno] = useState(today.getFullYear())
    const [docs, setDocs] = useState<FornitoreDocument[]>([])
    const [crosscheck, setCrosscheck] = useState<Map<number, CrosscheckRow[]>>(new Map())
    const [loading, setLoading] = useState(false)
    const [showUpload, setShowUpload] = useState(false)
    const [editingDoc, setEditingDoc] = useState<FornitoreDocument | null>(null)
    const [paymentDoc, setPaymentDoc] = useState<FornitoreDocument | null>(null)
    const [crossCheckRunning, setCrossCheckRunning] = useState(false)
    const [otpUnlocked, setOtpUnlocked] = useState(false)
    const [otpOpen, setOtpOpen] = useState(false)
    const draftSessionId = useRef(`fornitori-${fornitore.id}-${Date.now()}`).current

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

    const bolle = useMemo(() => docs.filter(d => d.tipo === 'ddt' || d.tipo === 'bolla'), [docs])
    const fatture = useMemo(() => docs.filter(d => d.tipo === 'fattura'), [docs])
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
        crosscheck.forEach((rows, mese) => {
            rows.forEach(r => {
                if (r.stato_calcolato === 'anomalia') all.push({ ...r, mese })
            })
        })
        return all
    }, [crosscheck])

    const fatturaById = useMemo(() => {
        const m = new Map<string, FornitoreDocument>()
        for (const d of fatture) m.set(d.id, d)
        return m
    }, [fatture])

    const countOk = useMemo(() => {
        let n = 0
        crosscheck.forEach(rows => {
            n += rows.filter(r => r.stato_calcolato === 'verificato').length
        })
        return n
    }, [crosscheck])

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

    async function runManualCrossCheck() {
        setCrossCheckRunning(true)
        try {
            const map = new Map<number, CrosscheckRow[]>()
            for (let m = 1; m <= 12; m++) {
                const cc = await runCrosscheck(fornitore.id, anno, m)
                if (cc.length > 0) {
                    map.set(m, cc)
                    // Apply crosscheck → set verificato/anomalia stato + create alerts
                    await applyCrosscheckToFatture(cc, fatture)
                }
            }
            setCrosscheck(map)
            // Reload docs to pick up updated stati
            await load()
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
        // Path 2 — fattura importata da Aruba SDI: scarica via API Aruba
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
                const url = URL.createObjectURL(blob)
                window.open(url, '_blank', 'noopener,noreferrer')
                setTimeout(() => URL.revokeObjectURL(url), 60000)
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
    for (let y = today.getFullYear() + 1; y >= 2020; y--) annoOptions.push(y)

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
                <select value={anno} onChange={e => setAnno(parseInt(e.target.value))}
                    className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
                    {annoOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>

            {/* STEP 1 — Carica bolle */}
            <Step n={1} title="Carica bolle" desc={`${bolle.length} caricate · ${fmtEUR(bolle.reduce((s, b) => s + Number(b.importo_totale || 0), 0))} totale`}>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <Button onClick={() => { setEditingDoc(null); setShowUpload(true) }}>+ Carica bolla</Button>
                    {loading && <span className="text-xs text-theme-text-muted">Caricamento…</span>}
                </div>
                <CompactDocList docs={bolle.slice(0, 10)} viewFile={viewFile}
                    onEdit={(d) => { setEditingDoc(d); setShowUpload(true) }} />
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
                <FornitoreDocumentUpload
                    fornitore={fornitore}
                    document={editingDoc}
                    onClose={() => { setShowUpload(false); setEditingDoc(null) }}
                    onSaved={() => { setShowUpload(false); setEditingDoc(null); load() }}
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

function CompactDocList({ docs, viewFile, onEdit }: {
    docs: FornitoreDocument[]
    viewFile: (d: FornitoreDocument) => void
    onEdit: (d: FornitoreDocument) => void
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
