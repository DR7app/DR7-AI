import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import toast from 'react-hot-toast'

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
    const [sending, setSending] = useState(false)

    const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
    const [loadingCampaigns, setLoadingCampaigns] = useState(false)

    useEffect(() => {
        loadCustomers()
        loadCampaigns()
    }, [])

    async function loadCustomers() {
        setLoadingCustomers(true)
        try {
            const map = new Map<string, Customer>()

            const { data: bookings } = await supabase
                .from('bookings')
                .select('customer_name, customer_email, customer_phone, user_id, booking_details')

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(bookings || []).forEach((b: any) => {
                const details = b.booking_details?.customer || {}
                const fullName = b.customer_name || details.fullName || 'Cliente'
                const email = b.customer_email || details.email || null
                const phone = b.customer_phone || details.phone || null
                const key = email || phone || b.user_id
                if (!key || map.has(key)) return
                map.set(key, {
                    id: b.user_id || key,
                    full_name: fullName,
                    email,
                    phone,
                    nome: fullName.split(' ')[0],
                    cognome: fullName.split(' ').slice(1).join(' '),
                })
            })

            const { data: ext } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, telefono, tipo_cliente, ragione_sociale, denominazione')

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(ext || []).forEach((c: any) => {
                const fullName = c.tipo_cliente === 'persona_fisica'
                    ? `${c.nome || ''} ${c.cognome || ''}`.trim()
                    : (c.ragione_sociale || c.denominazione || 'Cliente')
                const key = c.email || c.telefono || c.id
                map.set(key, {
                    id: c.id,
                    full_name: fullName || 'Cliente',
                    email: c.email,
                    phone: c.telefono,
                    nome: c.nome,
                    cognome: c.cognome,
                })
            })

            const list = Array.from(map.values())
                .filter(c => c.phone)
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
                    video_url,
                    channel: 'whatsapp',
                    audience: selectedIds.size === customers.length ? 'all' : 'selected',
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
            const { data: insertedRecipients, error: recErr } = await supabase
                .from('marketing_campaign_recipients')
                .insert(recipientRows)
                .select('id, customer_id, customer_name, phone, email')
            if (recErr) throw recErr

            const payload = (insertedRecipients || []).map((r, i) => ({
                id: r.id,
                customer_id: r.customer_id,
                customer_name: r.customer_name,
                phone: r.phone,
                email: r.email,
                nome: recipients[i]?.nome,
                cognome: recipients[i]?.cognome,
            }))

            toast.loading(`Invio in corso a ${recipients.length} clienti...`, { id: 'send' })
            const res = await fetch('/.netlify/functions/send-whatsapp-campaign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaignId: campaign.id,
                    customers: payload,
                    message,
                    imageUrls,
                    videoUrl: video_url,
                }),
            })
            const result = await res.json()
            toast.dismiss('send')

            if (!result.success) throw new Error(result.error || 'Errore invio')
            toast.success(`Campagna inviata: ${result.sent}/${result.total} (${result.failed} falliti)`)

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

    const filtered = customers.filter(c => {
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
                        <Button onClick={handleSend} disabled={sending || selectedIds.size === 0}>
                            {sending ? 'Invio in corso...' : `Invia a ${selectedIds.size} clienti`}
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
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {campaigns.map(c => (
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
                                </tr>
                            ))}
                            {campaigns.length === 0 && (
                                <tr><td colSpan={7} className="p-6 text-center text-theme-text-muted">Nessuna campagna ancora inviata</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
