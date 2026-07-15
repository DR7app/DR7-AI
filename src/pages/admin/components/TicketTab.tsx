import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

// ── Tipi ────────────────────────────────────────────────────────────────────
interface TicketRecipient {
    id: string
    nome: string
    reparto: string
    whatsapp: string
    attivo: boolean
}

interface Allegato { name: string; url: string; size: number }

interface Ticket {
    id: string
    numero: string
    reparto: string
    recipient_nome: string | null
    recipient_whatsapp: string | null
    oggetto: string | null
    descrizione: string
    priorita: string
    telefono_riferimento: string | null
    allegati: Allegato[]
    richiedente_nome: string | null
    stato: string
    whatsapp_sent: boolean
    created_at: string
}

const REPARTI = ['Direzione', 'Software', 'Amministrazione', 'Officina', 'Altro'] as const
const PRIORITA: { value: string; label: string; dot: string; badge: string }[] = [
    { value: 'bassa', label: 'Bassa', dot: 'bg-emerald-500', badge: 'bg-emerald-600 text-white' },
    { value: 'media', label: 'Media', dot: 'bg-blue-500', badge: 'bg-blue-600 text-white' },
    { value: 'alta', label: 'Alta', dot: 'bg-orange-500', badge: 'bg-orange-600 text-white' },
    { value: 'urgente', label: 'Urgente', dot: 'bg-red-500', badge: 'bg-red-600 text-white' },
]
const MAX_FILE_MB = 10
const ALLOWED = ['image/jpeg', 'image/png', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']

const prioLabel = (v: string) => PRIORITA.find(p => p.value === v)?.label || v

export default function TicketTab() {
    const [view, setView] = useState<'nuovo' | 'inviati'>('nuovo')
    const [recipients, setRecipients] = useState<TicketRecipient[]>([])
    const [tickets, setTickets] = useState<Ticket[]>([])
    const [richiedente, setRichiedente] = useState<{ nome: string; email: string }>({ nome: '', email: '' })
    const [showRecipientMgr, setShowRecipientMgr] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    const [form, setForm] = useState({
        reparto: 'Direzione',
        recipient_id: '',
        oggetto: '',
        descrizione: '',
        priorita: 'media',
        telefono_riferimento: '',
    })
    const [files, setFiles] = useState<File[]>([])

    // ── Load ──────────────────────────────────────────────────────────────────
    const loadRecipients = useCallback(async () => {
        const { data } = await supabase
            .from('ticket_recipients')
            .select('*')
            .order('created_at', { ascending: true })
        setRecipients(data || [])
    }, [])

    const loadTickets = useCallback(async () => {
        const { data } = await supabase
            .from('tickets')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200)
        setTickets((data || []) as Ticket[])
    }, [])

    useEffect(() => { loadRecipients() }, [loadRecipients])
    useEffect(() => { if (view === 'inviati') loadTickets() }, [view, loadTickets])

    useEffect(() => {
        (async () => {
            const { data: { user } } = await supabase.auth.getUser()
            const email = user?.email || ''
            let nome = email
            if (email) {
                const { data: adm } = await supabase.from('admins').select('nome').eq('email', email).maybeSingle()
                if (adm?.nome) nome = adm.nome
            }
            setRichiedente({ nome, email })
        })()
    }, [])

    const activeRecipients = useMemo(() => recipients.filter(r => r.attivo), [recipients])
    const selectedRecipient = useMemo(
        () => recipients.find(r => r.id === form.recipient_id) || null,
        [recipients, form.recipient_id]
    )

    // ── Messaggio WhatsApp ─────────────────────────────────────────────────────
    const buildMessage = useCallback((numero: string) => {
        const now = new Date()
        const data = now.toLocaleDateString('it-IT')
        const ora = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
        const telBlock = form.telefono_riferimento.trim()
            ? `\nTelefono di riferimento:\n${form.telefono_riferimento.trim()}\n`
            : ''
        const allegatiBlock = files.length > 0
            ? `\nAllegati: ${files.length} file (inviati separatamente)\n`
            : ''
        return (
            `NUOVO TICKET DR7\n` +
            `----------------------------\n` +
            `Ticket n.: #${numero}\n` +
            `Reparto: ${form.reparto}\n` +
            `Richiedente: ${richiedente.nome || '-'}\n` +
            `Priorità: ${prioLabel(form.priorita)}\n\n` +
            `Oggetto: ${form.oggetto || '-'}\n\n` +
            `Descrizione:\n${form.descrizione || '-'}\n` +
            telBlock +
            allegatiBlock +
            `\nAperto il: ${data} - ${ora}`
        )
    }, [form, richiedente.nome, files.length])

    const previewMessage = useMemo(() => buildMessage('2026-XXXX'), [buildMessage])

    // ── File handling ──────────────────────────────────────────────────────────
    const addFiles = (list: FileList | null) => {
        if (!list) return
        const next: File[] = []
        for (const f of Array.from(list)) {
            if (!ALLOWED.includes(f.type)) { toast.error(`Formato non supportato: ${f.name}`); continue }
            if (f.size > MAX_FILE_MB * 1024 * 1024) { toast.error(`${f.name} supera ${MAX_FILE_MB}MB`); continue }
            next.push(f)
        }
        if (next.length) setFiles(prev => [...prev, ...next])
    }
    const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx))

    // ── Submit ─────────────────────────────────────────────────────────────────
    const resetForm = () => {
        setForm({ reparto: 'Direzione', recipient_id: '', oggetto: '', descrizione: '', priorita: 'media', telefono_riferimento: '' })
        setFiles([])
    }

    const handleSubmit = async () => {
        if (!form.recipient_id || !selectedRecipient) { toast.error('Seleziona un destinatario'); return }
        if (!form.descrizione.trim()) { toast.error('La descrizione è obbligatoria'); return }

        setSubmitting(true)
        try {
            // 1) Inserisci il ticket (numero assegnato dal DB)
            const { data: inserted, error: insErr } = await supabase
                .from('tickets')
                .insert({
                    reparto: form.reparto,
                    recipient_id: selectedRecipient.id,
                    recipient_nome: selectedRecipient.nome,
                    recipient_whatsapp: selectedRecipient.whatsapp,
                    oggetto: form.oggetto.trim() || null,
                    descrizione: form.descrizione.trim(),
                    priorita: form.priorita,
                    telefono_riferimento: form.telefono_riferimento.trim() || null,
                    richiedente_nome: richiedente.nome || null,
                    richiedente_email: richiedente.email || null,
                    stato: 'inviato',
                })
                .select('id, numero')
                .single()
            if (insErr) throw insErr
            const ticketId = inserted.id as string
            const numero = inserted.numero as string

            // 2) Upload allegati (se presenti)
            const allegati: Allegato[] = []
            for (const f of files) {
                const safe = f.name.replace(/[^\w.\-]+/g, '_')
                const path = `${ticketId}/${Date.now()}_${safe}`
                const { error: upErr } = await supabase.storage.from('ticket-attachments').upload(path, f, { upsert: false })
                if (upErr) { console.warn('[Ticket] upload allegato fallito:', upErr.message); continue }
                const { data: pub } = supabase.storage.from('ticket-attachments').getPublicUrl(path)
                allegati.push({ name: f.name, url: pub.publicUrl, size: f.size })
            }
            if (allegati.length > 0) {
                await supabase.from('tickets').update({ allegati }).eq('id', ticketId)
            }

            // 3) Messaggio WhatsApp (con link allegati) → invio via Green API
            let message = buildMessage(numero)
            if (allegati.length > 0) {
                message += `\n\nAllegati:\n` + allegati.map(a => `• ${a.name}: ${a.url}`).join('\n')
            }
            const res = await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customPhone: selectedRecipient.whatsapp,
                    customMessage: message,
                    type: 'Nuovo Ticket',
                }),
            })
            const j = await res.json().catch(() => ({}))
            if (res.ok && !j?.error) {
                await supabase.from('tickets').update({ whatsapp_sent: true, whatsapp_sent_at: new Date().toISOString() }).eq('id', ticketId)
                toast.success(`Ticket #${numero} aperto e inviato a ${selectedRecipient.nome} via WhatsApp`)
            } else {
                toast.error(`Ticket #${numero} salvato, ma invio WhatsApp non riuscito: ${j?.error || 'errore'}`)
            }
            resetForm()
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            toast.error(`Errore apertura ticket: ${msg}`)
        } finally {
            setSubmitting(false)
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="p-6 space-y-6">
            {/* Header + sub-nav */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 grid place-items-center">
                        <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 010 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 010-4V7a2 2 0 00-2-2H5z"/></svg>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-theme-text-primary">Ticket</h2>
                        <p className="text-xs text-theme-text-muted">Richiedi autorizzazioni o assistenza via WhatsApp</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setView('nuovo')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${view === 'nuovo' ? 'bg-cyan-600 text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}>Nuovo Ticket</button>
                    <button onClick={() => setView('inviati')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${view === 'inviati' ? 'bg-cyan-600 text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}>Ticket inviati</button>
                </div>
            </div>

            {view === 'nuovo' ? (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    {/* FORM */}
                    <div className="xl:col-span-2 bg-theme-bg-secondary border border-theme-border rounded-2xl p-6 space-y-4">
                        <h3 className="text-lg font-bold text-theme-text-primary">Apri un nuovo ticket</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-1.5">Reparto *</label>
                                <select value={form.reparto} onChange={e => setForm({ ...form, reparto: e.target.value })} className="w-full px-4 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-cyan-500">
                                    {REPARTI.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-1.5">Destinatario *</label>
                                <select value={form.recipient_id} onChange={e => setForm({ ...form, recipient_id: e.target.value })} className="w-full px-4 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-cyan-500">
                                    <option value="">Seleziona destinatario…</option>
                                    {activeRecipients.map(r => <option key={r.id} value={r.id}>{r.nome} ({r.reparto})</option>)}
                                </select>
                                {selectedRecipient && (
                                    <p className="text-xs text-emerald-500 mt-1 font-mono">{selectedRecipient.whatsapp}</p>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-theme-text-primary mb-1.5">Oggetto del ticket</label>
                            <input type="text" value={form.oggetto} onChange={e => setForm({ ...form, oggetto: e.target.value })} placeholder="Es. Autorizzazione consegna veicolo senza cauzione" className="w-full px-4 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-cyan-500" />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-theme-text-primary mb-1.5">Descrizione dettagliata *</label>
                            <textarea value={form.descrizione} onChange={e => setForm({ ...form, descrizione: e.target.value })} rows={4} placeholder="Descrivi la richiesta…" className="w-full px-4 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-cyan-500 resize-y" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-1.5">Priorità *</label>
                                <select value={form.priorita} onChange={e => setForm({ ...form, priorita: e.target.value })} className="w-full px-4 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-cyan-500">
                                    {PRIORITA.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-theme-text-primary mb-1.5">Telefono di riferimento <span className="text-theme-text-muted font-normal">(facoltativo)</span></label>
                                <input type="text" value={form.telefono_riferimento} onChange={e => setForm({ ...form, telefono_riferimento: e.target.value })} placeholder="+39 347 9876543" className="w-full px-4 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-cyan-500" />
                            </div>
                        </div>

                        {/* Allegati */}
                        <div>
                            <label className="block text-sm font-semibold text-theme-text-primary mb-1.5">Allegati <span className="text-theme-text-muted font-normal">(facoltativo)</span></label>
                            <label
                                onDragOver={e => e.preventDefault()}
                                onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
                                className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-theme-border rounded-xl py-6 cursor-pointer hover:border-cyan-500/60 transition-colors"
                            >
                                <span className="text-sm text-theme-text-secondary">Trascina i file qui oppure <span className="text-cyan-500 font-medium">clicca per selezionare</span></span>
                                <span className="text-xs text-theme-text-muted">JPG, PNG, PDF, DOC, DOCX (max {MAX_FILE_MB}MB)</span>
                                <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" className="hidden" onChange={e => addFiles(e.target.files)} />
                            </label>
                            {files.length > 0 && (
                                <div className="mt-2 space-y-2">
                                    {files.map((f, i) => (
                                        <div key={i} className="flex items-center justify-between bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2">
                                            <div className="min-w-0">
                                                <div className="text-sm text-theme-text-primary truncate">{f.name}</div>
                                                <div className="text-xs text-theme-text-muted">{(f.size / 1024).toFixed(0)} KB</div>
                                            </div>
                                            <button onClick={() => removeFile(i)} className="text-red-500 hover:text-red-600 text-lg leading-none px-2">×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button onClick={resetForm} disabled={submitting} className="px-5 py-2.5 rounded-full bg-theme-bg-hover text-theme-text-primary hover:bg-theme-bg-tertiary transition-colors disabled:opacity-50">Annulla</button>
                            <button onClick={handleSubmit} disabled={submitting} className="px-6 py-2.5 rounded-full bg-cyan-600 text-white font-semibold hover:bg-cyan-700 transition-colors disabled:opacity-50 flex items-center gap-2">
                                {submitting ? 'Invio…' : 'Apri Ticket'}
                            </button>
                        </div>
                    </div>

                    {/* PREVIEW + destinatari */}
                    <div className="space-y-4">
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-5">
                            <h3 className="text-sm font-bold text-theme-text-primary mb-3">Anteprima messaggio WhatsApp</h3>
                            <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-theme-text-primary bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 font-sans">{previewMessage}</pre>
                            <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white text-xs font-medium py-2">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.5-.7-2.5-1.3-3.5-3-.3-.5.3-.4.8-1.4.1-.2 0-.4 0-.5s-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.6 1.9.8 2.6.9 3.6.7.6-.1 1.7-.7 1.9-1.4.2-.6.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z"/></svg>
                                Il messaggio verrà inviato su WhatsApp
                            </div>
                        </div>

                        <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-bold text-theme-text-primary">Destinatari</h3>
                                <button onClick={() => setShowRecipientMgr(true)} className="text-xs text-cyan-500 hover:text-cyan-400 font-medium">Gestisci</button>
                            </div>
                            {activeRecipients.length === 0 ? (
                                <p className="text-xs text-theme-text-muted">Nessun destinatario. Aggiungine uno da "Gestisci".</p>
                            ) : (
                                <div className="space-y-2.5">
                                    {activeRecipients.slice(0, 6).map(r => {
                                        const initials = r.nome.split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase()
                                        return (
                                            <button key={r.id} onClick={() => setForm(f => ({ ...f, recipient_id: r.id }))} className="w-full flex items-center gap-2.5 text-left hover:bg-theme-bg-hover rounded-lg p-1.5 transition-colors">
                                                <div className="w-8 h-8 rounded-full bg-cyan-500/15 text-cyan-400 grid place-items-center text-[11px] font-bold flex-shrink-0">{initials}</div>
                                                <div className="min-w-0">
                                                    <div className="text-xs font-semibold text-theme-text-primary truncate">{r.nome} <span className="text-theme-text-muted font-normal">({r.reparto})</span></div>
                                                    <div className="text-[11px] font-mono text-theme-text-muted truncate">{r.whatsapp}</div>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                            <button onClick={() => setShowRecipientMgr(true)} className="mt-3 w-full py-2 rounded-full border border-theme-border text-theme-text-secondary text-xs font-medium hover:bg-theme-bg-hover transition-colors">Gestisci destinatari</button>
                        </div>
                    </div>
                </div>
            ) : (
                <TicketInviatiList tickets={tickets} onRefresh={loadTickets} />
            )}

            {showRecipientMgr && (
                <RecipientManager recipients={recipients} onClose={() => setShowRecipientMgr(false)} onChanged={loadRecipients} />
            )}
        </div>
    )
}

// ── Lista ticket inviati ─────────────────────────────────────────────────────
function TicketInviatiList({ tickets }: { tickets: Ticket[]; onRefresh: () => void }) {
    if (tickets.length === 0) {
        return <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-10 text-center text-theme-text-secondary">Nessun ticket inviato.</div>
    }
    return (
        <div className="space-y-3">
            {tickets.map(t => {
                const p = PRIORITA.find(x => x.value === t.priorita)
                return (
                    <div key={t.id} className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-bold text-theme-text-primary">#{t.numero}</span>
                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${p?.badge || 'bg-gray-600 text-white'}`}>{prioLabel(t.priorita)}</span>
                                    <span className="text-xs text-theme-text-muted">{t.reparto}</span>
                                    {t.whatsapp_sent
                                        ? <span className="text-[10px] text-emerald-500 font-semibold">WhatsApp inviato</span>
                                        : <span className="text-[10px] text-red-500 font-semibold">Invio non riuscito</span>}
                                </div>
                                <div className="text-sm font-semibold text-theme-text-primary mt-1">{t.oggetto || '(nessun oggetto)'}</div>
                                <div className="text-xs text-theme-text-secondary mt-0.5 line-clamp-2 whitespace-pre-wrap">{t.descrizione}</div>
                                <div className="text-[11px] text-theme-text-muted mt-1">
                                    A: {t.recipient_nome || '-'} · Da: {t.richiedente_nome || '-'} · {new Date(t.created_at).toLocaleString('it-IT')}
                                    {t.allegati?.length ? ` · ${t.allegati.length} allegato/i` : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

// ── Gestione destinatari ─────────────────────────────────────────────────────
function RecipientManager({ recipients, onClose, onChanged }: { recipients: TicketRecipient[]; onClose: () => void; onChanged: () => void }) {
    const [form, setForm] = useState({ nome: '', reparto: 'Direzione', whatsapp: '' })
    const [editingId, setEditingId] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const reset = () => { setForm({ nome: '', reparto: 'Direzione', whatsapp: '' }); setEditingId(null) }

    const save = async () => {
        if (!form.nome.trim() || !form.whatsapp.trim()) { toast.error('Nome e numero WhatsApp obbligatori'); return }
        const whatsapp = form.whatsapp.replace(/\D/g, '')
        if (whatsapp.length < 8) { toast.error('Numero WhatsApp non valido'); return }
        setBusy(true)
        try {
            if (editingId) {
                const { error } = await supabase.from('ticket_recipients').update({ nome: form.nome.trim(), reparto: form.reparto, whatsapp, updated_at: new Date().toISOString() }).eq('id', editingId)
                if (error) throw error
                toast.success('Destinatario aggiornato')
            } else {
                const { error } = await supabase.from('ticket_recipients').insert({ nome: form.nome.trim(), reparto: form.reparto, whatsapp })
                if (error) throw error
                toast.success('Destinatario aggiunto')
            }
            reset(); onChanged()
        } catch (e: unknown) {
            toast.error(`Errore: ${e instanceof Error ? e.message : String(e)}`)
        } finally { setBusy(false) }
    }

    const toggleAttivo = async (r: TicketRecipient) => {
        await supabase.from('ticket_recipients').update({ attivo: !r.attivo, updated_at: new Date().toISOString() }).eq('id', r.id)
        onChanged()
    }
    const remove = async (r: TicketRecipient) => {
        if (!confirm(`Eliminare ${r.nome}?`)) return
        await supabase.from('ticket_recipients').delete().eq('id', r.id)
        toast.success('Destinatario eliminato'); onChanged()
    }
    const startEdit = (r: TicketRecipient) => { setForm({ nome: r.nome, reparto: r.reparto, whatsapp: r.whatsapp }); setEditingId(r.id) }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-5 border-b border-theme-border flex justify-between items-center">
                    <h3 className="text-lg font-bold text-theme-text-primary">Gestione destinatari ticket</h3>
                    <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none">×</button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Form add/edit */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Nome" className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-cyan-500" />
                        <select value={form.reparto} onChange={e => setForm({ ...form, reparto: e.target.value })} className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-cyan-500">
                            {REPARTI.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <input value={form.whatsapp} onChange={e => setForm({ ...form, whatsapp: e.target.value })} placeholder="393471234567" className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary font-mono focus:outline-none focus:border-cyan-500" />
                    </div>
                    <div className="flex gap-2">
                        <button onClick={save} disabled={busy} className="px-5 py-2 rounded-full bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50">{editingId ? 'Salva modifiche' : 'Aggiungi destinatario'}</button>
                        {editingId && <button onClick={reset} className="px-4 py-2 rounded-full bg-theme-bg-hover text-theme-text-primary text-sm">Annulla</button>}
                    </div>

                    {/* Lista */}
                    <div className="space-y-2 pt-2">
                        {recipients.length === 0 && <p className="text-sm text-theme-text-muted">Nessun destinatario.</p>}
                        {recipients.map(r => (
                            <div key={r.id} className={`flex items-center justify-between gap-2 border border-theme-border rounded-lg px-3 py-2 ${r.attivo ? '' : 'opacity-50'}`}>
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-theme-text-primary truncate">{r.nome} <span className="text-theme-text-muted font-normal">({r.reparto})</span></div>
                                    <div className="text-xs font-mono text-theme-text-muted">{r.whatsapp}</div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button onClick={() => toggleAttivo(r)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${r.attivo ? 'bg-emerald-600 text-white' : 'bg-theme-bg-hover text-theme-text-secondary'}`}>{r.attivo ? 'Attivo' : 'Disattivo'}</button>
                                    <button onClick={() => startEdit(r)} className="px-2.5 py-1 rounded-full text-[11px] bg-blue-600 text-white">Modifica</button>
                                    <button onClick={() => remove(r)} className="px-2.5 py-1 rounded-full text-[11px] bg-red-600 text-white">Elimina</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
