import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import toast from 'react-hot-toast'
import { useClientStatus } from '../../../contexts/ClientStatusContext'

interface Customer {
    id: string
    full_name: string
    email: string | null
    phone: string | null
    nome?: string
    cognome?: string
}

interface CampaignRow {
    id: string
    title: string
    message_text: string
    image_url: string | null
    image_urls: string[] | null
    video_url: string | null
    total_recipients: number
    sent_count: number
    failed_count: number
    status: string
    created_at: string
}

const PER_PAGE = 50

export default function CampagnaMarketingTab() {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [loadingCustomers, setLoadingCustomers] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    const [title, setTitle] = useState('')
    const [message, setMessage] = useState('')
    const [imageFiles, setImageFiles] = useState<File[]>([])
    const [imagePreviews, setImagePreviews] = useState<string[]>([])
    const [videoFile, setVideoFile] = useState<File | null>(null)
    const [videoPreview, setVideoPreview] = useState<string>('')
    const [, setSending] = useState(false)

    const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
    const [loadingCampaigns, setLoadingCampaigns] = useState(false)

    // Exclusion filters (blacklist excluded by default — never message blacklisted leads)
    const [excludeBlacklist, setExcludeBlacklist] = useState(true)
    const [excludeMember, setExcludeMember] = useState(false)
    const [excludeElite, setExcludeElite] = useState(false)
    const [excludeNewEntry, setExcludeNewEntry] = useState(false)
    const [excludeDr7Club, setExcludeDr7Club] = useState(false)

    const clientStatus = useClientStatus()

    // Auto-refresh storico every 5s while a campaign is in flight ('pending' or 'sending'),
    // so progress counters update without the user clicking Aggiorna.
    useEffect(() => {
        const inFlight = campaigns.some(c => c.status === 'pending' || c.status === 'sending')
        if (!inFlight) return
        const t = setInterval(() => { loadCampaigns() }, 5000)
        return () => clearInterval(t)
    }, [campaigns])

    useEffect(() => {
        loadCustomers()
        loadCampaigns()
    }, [])

    async function loadCustomers() {
        setLoadingCustomers(true)
        try {
            const map = new Map<string, Customer>()

            // Use Netlify function (bypasses RLS) — same source as Lead/Clienti tab
            const response = await fetch('/.netlify/functions/list-customers')
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'list-customers failed')

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(result.customers || []).forEach((c: any) => {
                const fullName = c.tipo_cliente === 'persona_fisica'
                    ? `${c.nome || ''} ${c.cognome || ''}`.trim()
                    : (c.ragione_sociale || c.denominazione || 'Cliente')
                const key = c.id || c.email || c.telefono
                if (!key) return
                map.set(key, {
                    id: c.id,
                    full_name: fullName || 'Cliente',
                    email: c.email || null,
                    phone: c.telefono || null,
                    nome: c.nome,
                    cognome: c.cognome,
                })
            })

            const list = Array.from(map.values())
                .sort((a, b) => a.full_name.localeCompare(b.full_name))
            setCustomers(list)
        } catch (err) {
            console.error('Error loading customers:', err)
            toast.error('Errore caricamento clienti')
        } finally {
            setLoadingCustomers(false)
        }
    }

    async function loadCampaigns() {
        setLoadingCampaigns(true)
        try {
            const { data, error } = await supabase
                .from('marketing_campaigns')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(20)
            if (error) throw error
            setCampaigns(data || [])
        } catch (err) {
            console.error('Error loading campaigns:', err)
        } finally {
            setLoadingCampaigns(false)
        }
    }

    function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || [])
        if (files.length === 0) return
        const valid = files.filter(f => f.type.startsWith('image/'))
        if (valid.length !== files.length) toast.error('Alcuni file non sono immagini e sono stati ignorati')
        const oversize = valid.find(f => f.size > 10 * 1024 * 1024)
        if (oversize) {
            toast.error(`"${oversize.name}" supera i 10MB`)
            return
        }
        setImageFiles(prev => [...prev, ...valid])
        valid.forEach(file => {
            const reader = new FileReader()
            reader.onloadend = () => setImagePreviews(prev => [...prev, reader.result as string])
            reader.readAsDataURL(file)
        })
        e.target.value = ''
    }

    function removeImage(index: number) {
        setImageFiles(prev => prev.filter((_, i) => i !== index))
        setImagePreviews(prev => prev.filter((_, i) => i !== index))
    }

    function handleVideoChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        if (!file.type.startsWith('video/')) {
            toast.error('Seleziona un file video')
            return
        }
        if (file.size > 30 * 1024 * 1024) {
            toast.error('Video troppo grande (max 30MB)')
            return
        }
        setVideoFile(file)
        setVideoPreview(URL.createObjectURL(file))
    }

    async function uploadMedia(file: File, prefix: string): Promise<string> {
        const ext = file.name.split('.').pop() || 'bin'
        const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error } = await supabase.storage
            .from('marketing-campaigns')
            .upload(path, file, { cacheControl: '3600', upsert: false })
        if (error) throw error
        const { data } = supabase.storage.from('marketing-campaigns').getPublicUrl(path)
        return data.publicUrl
    }

    async function handleSend() {
        if (!title.trim()) return toast.error('Inserisci un titolo')
        if (!message.trim()) return toast.error('Inserisci il messaggio')
        if (selectedIds.size === 0) return toast.error('Seleziona almeno un cliente')

        const recipients = customers.filter(c => selectedIds.has(c.id))
        if (recipients.length === 0) return toast.error('Nessun destinatario valido')

        if (!confirm(`Inviare la campagna a ${recipients.length} clienti? L'invio parte subito.`)) return

        setSending(true)
        try {
            const imageUrls: string[] = []
            let video_url: string | null = null
            if (imageFiles.length > 0) {
                toast.loading(`Caricamento ${imageFiles.length} ${imageFiles.length === 1 ? 'immagine' : 'immagini'}...`, { id: 'upload' })
                for (const file of imageFiles) {
                    imageUrls.push(await uploadMedia(file, 'images'))
                }
            }
            if (videoFile) {
                toast.loading('Caricamento video...', { id: 'upload' })
                video_url = await uploadMedia(videoFile, 'videos')
            }
            toast.dismiss('upload')

            const { data: campaign, error: campErr } = await supabase
                .from('marketing_campaigns')
                .insert({
                    title,
                    message_text: message,
                    image_url: imageUrls[0] || null,
                    image_urls: imageUrls.length > 0 ? imageUrls : null,
                    video_url,
                    channel: 'whatsapp',
                    audience: selectedIds.size === eligible.length ? 'all' : 'selected',
                    total_recipients: recipients.length,
                    status: 'pending',
                })
                .select()
                .single()
            if (campErr) throw campErr

            const recipientRows = recipients.map(c => ({
                campaign_id: campaign.id,
                customer_id: c.id.length === 36 ? c.id : null,
                customer_name: c.full_name,
                phone: c.phone,
                email: c.email,
                status: 'pending',
            }))
            const { error: recErr } = await supabase
                .from('marketing_campaign_recipients')
                .insert(recipientRows)
            if (recErr) throw recErr

            // Browser-driven chunked send: keeps calling the chunk endpoint
            // until 'done: true'. Stays under Netlify's 10s function timeout
            // and works on the free tier (no background functions needed).
            await runChunkedSend(campaign.id, recipients.length)
            toast.success('Campagna inviata.')

            setTitle('')
            setMessage('')
            setImageFiles([])
            setImagePreviews([])
            setVideoFile(null)
            setVideoPreview('')
            setSelectedIds(new Set())
            loadCampaigns()
        } catch (err: unknown) {
            toast.dismiss('upload')
            toast.dismiss('send')
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(`Errore: ${msg}`)
        } finally {
            setSending(false)
        }
    }

    // Drives chunked sending: calls the chunk endpoint repeatedly until
    // 'done: true'. Updates a toast with live progress so the operator
    // sees X/Y as the run progresses.
    async function runChunkedSend(campaignId: string, total: number) {
        const toastId = `send-${campaignId}`
        let lastSent = 0
        let lastFailed = 0
        let stalled = 0
        toast.loading(`Invio in corso 0/${total}...`, { id: toastId })

        for (let i = 0; i < 1000; i++) {
            const res = await fetch('/.netlify/functions/send-whatsapp-campaign-chunk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campaignId }),
            })
            let result: any = null
            try { result = await res.json() } catch { /* ignore */ }
            if (!res.ok) {
                toast.dismiss(toastId)
                throw new Error(result?.error || `HTTP ${res.status}`)
            }
            const sentCount = result.sent_count ?? lastSent
            const failedCount = result.failed_count ?? lastFailed
            toast.loading(`Invio in corso: ${sentCount} inviati, ${failedCount} falliti, ${result.remaining ?? '?'} in attesa...`, { id: toastId })
            loadCampaigns()

            if (result.done) {
                toast.dismiss(toastId)
                return
            }
            // Detect a stalled run (no progress for 3 consecutive chunks) and bail
            if (sentCount === lastSent && failedCount === lastFailed && result.processed === 0) {
                stalled++
                if (stalled >= 3) {
                    toast.dismiss(toastId)
                    throw new Error('Invio bloccato: nessun progresso. Controlla Green API e i log.')
                }
            } else {
                stalled = 0
            }
            lastSent = sentCount
            lastFailed = failedCount
            await new Promise(r => setTimeout(r, 200))
        }
        toast.dismiss(toastId)
    }

    // @ts-expect-error -- kept for future re-enable; deliberately unused while CAMPAIGN_SENDS_ENABLED is false
    async function _handleResume(campaign: CampaignRow) {
        const { count: retryable } = await supabase
            .from('marketing_campaign_recipients')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaign.id)
            .in('status', ['pending', 'failed'])
        if (!retryable || retryable === 0) {
            toast('Nessun destinatario da riprovare')
            return
        }
        if (!confirm(`Riprovare l'invio a ${retryable} destinatari (pending + falliti)?`)) return

        try {
            // Reset failed → pending so they get picked up by the chunk loop
            await supabase
                .from('marketing_campaign_recipients')
                .update({ status: 'pending', error_message: null })
                .eq('campaign_id', campaign.id)
                .eq('status', 'failed')

            await runChunkedSend(campaign.id, retryable)
            toast.success('Riprova completata.')
            loadCampaigns()
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(`Errore riprova: ${msg}`)
        }
    }

    // Apply tier / DR7 Club exclusions BEFORE search + pagination so the
    // counts shown ("Seleziona tutti", "Selezionati") reflect what will
    // actually be sent.
    const eligible = useMemo(() => {
        return customers.filter(c => {
            const status = clientStatus.lookup({
                customerId: c.id,
                email: c.email,
                phone: c.phone,
            })
            const tier = status?.tier ?? 'new'
            const isDr7 = status?.dr7Club ?? false
            if (excludeBlacklist && tier === 'blacklist') return false
            if (excludeMember && tier === 'member') return false
            if (excludeElite && tier === 'elite') return false
            if (excludeNewEntry && tier === 'new') return false
            if (excludeDr7Club && isDr7) return false
            return true
        })
    }, [customers, clientStatus, excludeBlacklist, excludeMember, excludeElite, excludeNewEntry, excludeDr7Club])

    const excludedCount = customers.length - eligible.length

    const filtered = eligible.filter(c => {
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        return (
            c.full_name.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.phone?.toLowerCase().includes(q)
        )
    })
    const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))

    // Drop selected ids that have become ineligible after exclusion change
    useEffect(() => {
        if (selectedIds.size === 0) return
        const eligibleIds = new Set(eligible.map(c => c.id))
        let changed = false
        const next = new Set(selectedIds)
        for (const id of selectedIds) {
            if (!eligibleIds.has(id)) {
                next.delete(id)
                changed = true
            }
        }
        if (changed) setSelectedIds(next)
    }, [eligible, selectedIds])

    function toggle(id: string) {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedIds(next)
    }

    function selectAllFiltered() {
        const next = new Set(selectedIds)
        filtered.forEach(c => next.add(c.id))
        setSelectedIds(next)
    }

    function clearSelection() {
        setSelectedIds(new Set())
    }

    return (
        <div className="space-y-6">
            <div className="bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
                <h2 className="text-xl font-bold text-theme-text-primary">Campagna Marketing WhatsApp</h2>
                <p className="text-theme-text-muted text-sm">
                    Invia un messaggio (con foto e/o video) a tutti i lead o a una selezione. L'invio parte immediatamente.
                </p>
            </div>

            <div className="bg-red-600/10 border border-red-600/40 rounded-lg p-4">
                <p className="text-red-400 font-semibold text-sm">
                    Invio campagne sospeso temporaneamente
                </p>
                <p className="text-red-300/80 text-xs mt-1">
                    L'ultimo invio di massa ha attivato l'anti-spam di WhatsApp e disconnesso l'istanza Green API.
                    Riconnetti l'istanza (console.green-api.com → Scan QR) e poi riattiva l'invio rimuovendo il blocco
                    in <code className="bg-black/30 px-1 rounded">netlify/functions/send-whatsapp-campaign-chunk.ts</code>
                    (<code className="bg-black/30 px-1 rounded">CAMPAIGN_SENDS_ENABLED = true</code>).
                    Quando riattivato l'invio sarà a 1 messaggio ogni 7 secondi per evitare un nuovo ban.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Form */}
                <div className="bg-theme-bg-tertiary p-5 rounded-lg border border-theme-border space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Titolo campagna</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Es. Promo Pasqua 2026"
                            className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                            Messaggio <span className="text-theme-text-muted text-xs">(usa {'{nome}'} e {'{cognome}'} per personalizzare)</span>
                        </label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={6}
                            placeholder="Ciao {nome}, abbiamo una promo per te..."
                            className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold resize-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                                Foto (multipla, max 10MB cad.)
                            </label>
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleImageChange}
                                className="block w-full text-sm text-theme-text-muted file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:bg-dr7-gold file:text-white file:cursor-pointer"
                            />
                            {imagePreviews.length > 0 && (
                                <div className="mt-2 grid grid-cols-3 gap-2">
                                    {imagePreviews.map((src, i) => (
                                        <div key={i} className="relative">
                                            <img src={src} alt="" className="w-full h-20 object-cover rounded" />
                                            <button
                                                type="button"
                                                onClick={() => removeImage(i)}
                                                className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-5 h-5 text-xs leading-none"
                                            >×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Video (max 30MB)</label>
                            <input
                                type="file"
                                accept="video/*"
                                onChange={handleVideoChange}
                                className="block w-full text-sm text-theme-text-muted file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:bg-dr7-gold file:text-white file:cursor-pointer"
                            />
                            {videoPreview && (
                                <div className="mt-2 relative">
                                    <video src={videoPreview} className="w-full h-32 object-cover rounded" controls />
                                    <button
                                        type="button"
                                        onClick={() => { setVideoFile(null); setVideoPreview('') }}
                                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 text-xs"
                                    >×</button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-theme-border">
                        <div className="text-sm text-theme-text-muted">
                            Selezionati: <span className="font-bold text-dr7-gold">{selectedIds.size}</span>
                        </div>
                        <Button onClick={handleSend} disabled>
                            Invio sospeso
                        </Button>
                    </div>
                </div>

                {/* Recipients list */}
                <div className="bg-theme-bg-tertiary p-5 rounded-lg border border-theme-border space-y-3">
                    <div className="flex justify-between items-center">
                        <h3 className="font-semibold text-theme-text-primary">Destinatari</h3>
                        <div className="flex gap-2">
                            <button
                                onClick={selectAllFiltered}
                                className="text-xs px-3 py-1 rounded-full bg-theme-bg-secondary text-theme-text-secondary hover:bg-theme-bg-hover"
                            >
                                Seleziona tutti ({filtered.length})
                            </button>
                            {selectedIds.size > 0 && (
                                <button
                                    onClick={clearSelection}
                                    className="text-xs px-3 py-1 rounded-full bg-red-600/20 text-red-400 hover:bg-red-600/30"
                                >
                                    Deseleziona
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Exclusion filters */}
                    <div className="bg-theme-bg-secondary/50 border border-theme-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-theme-text-secondary uppercase">
                                Escludi categorie
                            </span>
                            {excludedCount > 0 && (
                                <span className="text-xs text-theme-text-muted">
                                    {excludedCount} esclusi · {eligible.length} disponibili
                                </span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                            <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-theme-bg-tertiary cursor-pointer hover:bg-theme-bg-hover">
                                <input
                                    type="checkbox"
                                    checked={excludeBlacklist}
                                    onChange={(e) => setExcludeBlacklist(e.target.checked)}
                                />
                                <span className="text-red-400">Blacklist</span>
                            </label>
                            <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-theme-bg-tertiary cursor-pointer hover:bg-theme-bg-hover">
                                <input
                                    type="checkbox"
                                    checked={excludeMember}
                                    onChange={(e) => setExcludeMember(e.target.checked)}
                                />
                                <span className="text-blue-400">Member</span>
                            </label>
                            <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-theme-bg-tertiary cursor-pointer hover:bg-theme-bg-hover">
                                <input
                                    type="checkbox"
                                    checked={excludeElite}
                                    onChange={(e) => setExcludeElite(e.target.checked)}
                                />
                                <span className="text-amber-400">Elite</span>
                            </label>
                            <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-theme-bg-tertiary cursor-pointer hover:bg-theme-bg-hover">
                                <input
                                    type="checkbox"
                                    checked={excludeNewEntry}
                                    onChange={(e) => setExcludeNewEntry(e.target.checked)}
                                />
                                <span className="text-emerald-400">New entry</span>
                            </label>
                            <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-theme-bg-tertiary cursor-pointer hover:bg-theme-bg-hover">
                                <input
                                    type="checkbox"
                                    checked={excludeDr7Club}
                                    onChange={(e) => setExcludeDr7Club(e.target.checked)}
                                />
                                <span className="text-[#D4B896]">DR7 Club</span>
                            </label>
                        </div>
                    </div>

                    <input
                        type="text"
                        placeholder="Cerca per nome, email, telefono..."
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
                        className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                    />

                    {loadingCustomers ? (
                        <div className="text-center py-6 text-dr7-gold text-sm">Caricamento clienti...</div>
                    ) : (
                        <>
                            <div className="max-h-96 overflow-y-auto border border-theme-border rounded">
                                <table className="w-full text-sm">
                                    <tbody className="divide-y divide-theme-border">
                                        {paginated.map(c => (
                                            <tr
                                                key={c.id}
                                                onClick={() => toggle(c.id)}
                                                className={`cursor-pointer hover:bg-theme-bg-hover ${selectedIds.has(c.id) ? 'bg-dr7-gold/10' : ''}`}
                                            >
                                                <td className="p-2 w-8 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(c.id)}
                                                        onChange={() => toggle(c.id)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </td>
                                                <td className="p-2 text-theme-text-primary font-medium">{c.full_name}</td>
                                                <td className="p-2 text-theme-text-muted text-xs">{c.phone || '-'}</td>
                                            </tr>
                                        ))}
                                        {paginated.length === 0 && (
                                            <tr><td colSpan={3} className="p-4 text-center text-theme-text-muted">Nessun cliente</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {totalPages > 1 && (
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-theme-text-muted">Pagina {page}/{totalPages}</span>
                                    <div className="flex gap-2">
                                        <Button variant="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prec.</Button>
                                        <Button variant="secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Succ.</Button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* History */}
            <div className="bg-theme-bg-tertiary rounded-lg border border-theme-border overflow-hidden">
                <div className="p-4 border-b border-theme-border flex justify-between items-center">
                    <h3 className="font-semibold text-theme-text-primary">Storico campagne</h3>
                    <Button variant="secondary" onClick={loadCampaigns}>Aggiorna</Button>
                </div>
                {loadingCampaigns ? (
                    <div className="text-center py-6 text-dr7-gold text-sm">Caricamento...</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-theme-bg-secondary/50 text-theme-text-secondary uppercase text-xs">
                            <tr>
                                <th className="p-3 text-left">Data</th>
                                <th className="p-3 text-left">Titolo</th>
                                <th className="p-3 text-left">Media</th>
                                <th className="p-3 text-left">Destinatari</th>
                                <th className="p-3 text-left">Inviati</th>
                                <th className="p-3 text-left">Falliti</th>
                                <th className="p-3 text-left">Stato</th>
                                <th className="p-3 text-right">Azioni</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {campaigns.map(c => {
                                // Show Riprova whenever there's any unsent work — covers stuck
                                // 'sending' campaigns (bg function died) AND completed campaigns
                                // with failures. Click handler bails out if nothing's actually retryable.
                                const canResume = c.sent_count < c.total_recipients
                                return (
                                <tr key={c.id} className="hover:bg-theme-bg-hover/50">
                                    <td className="p-3 text-theme-text-muted text-xs">
                                        {new Date(c.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="p-3 text-theme-text-primary font-medium">{c.title}</td>
                                    <td className="p-3 text-xs">
                                        {c.image_url && <span className="px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 mr-1">Foto</span>}
                                        {c.video_url && <span className="px-2 py-0.5 rounded bg-purple-600/20 text-purple-400">Video</span>}
                                        {!c.image_url && !c.video_url && <span className="text-theme-text-muted">-</span>}
                                    </td>
                                    <td className="p-3">{c.total_recipients}</td>
                                    <td className="p-3 text-green-400">{c.sent_count}</td>
                                    <td className="p-3 text-red-400">{c.failed_count}</td>
                                    <td className="p-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                                            c.status === 'completed' ? 'bg-green-600/20 text-green-400' :
                                            c.status === 'failed' ? 'bg-red-600/20 text-red-400' :
                                            c.status === 'sending' ? 'bg-yellow-600/20 text-yellow-400' :
                                            'bg-gray-600/20 text-gray-400'
                                        }`}>
                                            {c.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-right">
                                        {canResume && (
                                            <button
                                                disabled
                                                title="Invio sospeso temporaneamente"
                                                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-600 text-gray-300 cursor-not-allowed whitespace-nowrap"
                                            >
                                                Sospeso
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                )
                            })}
                            {campaigns.length === 0 && (
                                <tr><td colSpan={8} className="p-6 text-center text-theme-text-muted">Nessuna campagna ancora inviata</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
