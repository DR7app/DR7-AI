import { useState } from 'react'
import Button from './Button'

interface GiftVoucherModalProps {
    isOpen: boolean
    onClose: () => void
    selectedCustomers: Array<{ id: string; nome?: string; cognome?: string; email: string | null }>
    onSend: (data: { subject: string; message: string; images: File[]; channel?: 'email' | 'whatsapp' }) => Promise<void>
}

export default function GiftVoucherModal({ isOpen, onClose, selectedCustomers, onSend }: GiftVoucherModalProps) {
    const [channel, setChannel] = useState<'email' | 'whatsapp'>('email')
    const [subject, setSubject] = useState('🎁 Buono Regalo per te!')
    const [message, setMessage] = useState('Gentile Cliente,\nDR7 apre una finestra esclusiva a disponibilità limitata.\nCordiali saluti,\nDR7 S.p.A.')
    const [images, setImages] = useState<File[]>([])
    const [imagePreviews, setImagePreviews] = useState<string[]>([])
    const [sending, setSending] = useState(false)

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        if (files.length > 0) {
            // Validate file types
            const validFiles = files.filter(file => file.type.startsWith('image/'))
            if (validFiles.length !== files.length) {
                alert('Alcuni file non sono immagini e sono stati ignorati.')
            }

            // Validate total size (max 15MB total to be safe with Netlify)
            const totalSize = validFiles.reduce((acc, file) => acc + file.size, 0)
            if (totalSize > 15 * 1024 * 1024) {
                alert('La dimensione totale delle immagini è troppo grande. Massimo 15MB.')
                return
            }

            setImages(prev => [...prev, ...validFiles])

            // Create previews
            validFiles.forEach(file => {
                const reader = new FileReader()
                reader.onloadend = () => {
                    setImagePreviews(prev => [...prev, reader.result as string])
                }
                reader.readAsDataURL(file)
            })
        }
    }

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index))
        setImagePreviews(prev => prev.filter((_, i) => i !== index))
    }

    const handleSend = async () => {
        if (channel === 'email') {
            if (images.length === 0) {
                alert('Per favore carica almeno un\'immagine del buono regalo')
                return
            }
            if (!subject.trim()) {
                alert('Per favore inserisci un oggetto per l\'email')
                return
            }
        }

        if (!message.trim()) {
            alert('Per favore inserisci un messaggio')
            return
        }

        setSending(true)
        try {
            await onSend({ subject, message, images, channel })

            // Reset form
            setSubject('🎁 Buono Regalo per te!')
            setMessage('Gentile Cliente,\nDR7 apre una finestra esclusiva a disponibilità limitata.\nCordiali saluti,\nDR7 S.p.A.')
            setImages([])
            setImagePreviews([])
            onClose()
        } catch (error) {
            console.error('Error sending vouchers:', error)
            alert('Errore nell\'invio dei buoni regalo')
        } finally {
            setSending(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-theme-bg-primary/80 flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary border border-theme-border rounded-full max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-theme-bg-secondary border-b border-theme-border p-6 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-theme-text-primary">🎁 Invia Buono Regalo</h2>
                    <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary text-3xl">&times;</button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Channel Selection */}
                    <div className="bg-theme-bg-tertiary rounded-full p-4">
                        <label className="block text-sm font-medium text-theme-text-secondary mb-3">Canale di Invio</label>
                        <div className="flex gap-4">
                            <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${channel === 'email' ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border-light hover:bg-theme-bg-hover'}`}>
                                <input
                                    type="radio"
                                    name="channel"
                                    value="email"
                                    checked={channel === 'email'}
                                    onChange={() => setChannel('email')}
                                    className="text-dr7-gold focus:ring-dr7-gold"
                                />
                                <span className="text-theme-text-primary">📧 Email</span>
                            </label>
                            <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${channel === 'whatsapp' ? 'border-green-500 bg-green-500/10' : 'border-theme-border-light hover:bg-theme-bg-hover'}`}>
                                <input
                                    type="radio"
                                    name="channel"
                                    value="whatsapp"
                                    checked={channel === 'whatsapp'}
                                    onChange={() => setChannel('whatsapp')}
                                    className="text-green-500 focus:ring-green-500"
                                />
                                <span className="text-theme-text-primary">💬 WhatsApp</span>
                            </label>
                        </div>
                    </div>

                    {/* Selected Customers */}
                    <div className="bg-theme-bg-tertiary rounded-full p-4">
                        <h3 className="text-sm font-semibold text-theme-text-secondary mb-2">
                            Destinatari ({selectedCustomers.length})
                        </h3>
                        {channel === 'whatsapp' && (
                            <p className="text-xs text-yellow-500 mb-2">
                                ⚠️ Assicurati che i clienti abbiano un numero di telefono valido (+39...)
                            </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {selectedCustomers.slice(0, 10).map(customer => (
                                <span key={customer.id} className="px-3 py-1 bg-dr7-gold/20 text-dr7-gold rounded-full text-sm">
                                    {customer.nome && customer.cognome ? `${customer.nome} ${customer.cognome}` : customer.email}
                                </span>
                            ))}
                            {selectedCustomers.length > 10 && (
                                <span className="px-3 py-1 bg-gray-700 text-theme-text-secondary rounded-full text-sm">
                                    +{selectedCustomers.length - 10} altri
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Image Upload (Email Only) */}
                    {channel === 'email' && (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                                Immagine Buono Regalo *
                            </label>
                            <div className="border-2 border-dashed border-theme-border-light rounded-lg p-6 text-center">
                                <div className="space-y-4">
                                    {/* Preview Grid */}
                                    {imagePreviews.length > 0 && (
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                                            {imagePreviews.map((preview, index) => (
                                                <div key={index} className="relative group">
                                                    <img src={preview} alt={`Preview ${index}`} className="w-full h-24 object-cover rounded border border-theme-border-light" />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeImage(index)}
                                                        className="absolute -top-2 -right-2 bg-red-600 text-theme-text-primary rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div>
                                        <input
                                            type="file"
                                            multiple
                                            accept="image/jpeg,image/png,image/jpg"
                                            onChange={handleImageChange}
                                            className="hidden"
                                            id="voucher-image"
                                        />
                                        <label
                                            htmlFor="voucher-image"
                                            className="cursor-pointer inline-block px-4 py-2 bg-dr7-gold text-black rounded-full hover:bg-dr7-gold/90"
                                        >
                                            Carica Immagini Multiple (JPEG/PNG)
                                        </label>
                                        <p className="text-xs text-theme-text-muted mt-2">Massimo 15MB totali</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Email Subject (Email Only) */}
                    {channel === 'email' && (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                                Oggetto Email *
                            </label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-3 text-theme-text-primary focus:border-dr7-gold outline-none"
                                placeholder="🎁 Buono Regalo per te!"
                            />
                        </div>
                    )}

                    {/* Message */}
                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                            {channel === 'email' ? 'Messaggio Email *' : 'Messaggio WhatsApp *'}
                        </label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={6}
                            className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-3 text-theme-text-primary focus:border-dr7-gold outline-none"
                            placeholder="Scrivi il tuo messaggio..."
                        />
                        <p className="text-xs text-theme-text-muted mt-1">
                            Usa <code className="bg-gray-700 px-1 rounded">{'{nome}'}</code> e <code className="bg-gray-700 px-1 rounded">{'{cognome}'}</code> per personalizzare
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4 border-t border-theme-border">
                        <Button
                            onClick={onClose}
                            variant="secondary"
                            disabled={sending}
                        >
                            Annulla
                        </Button>
                        <Button
                            onClick={handleSend}
                            disabled={sending || (channel === 'email' && images.length === 0)}
                        >
                            {sending ? '⏳ Invio in corso...' :
                                channel === 'email'
                                    ? `📧 Invia a ${selectedCustomers.length} ${selectedCustomers.length === 1 ? 'cliente' : 'clienti'}`
                                    : `💬 Invia WhatsApp a ${selectedCustomers.length} ${selectedCustomers.length === 1 ? 'cliente' : 'clienti'}`
                            }
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
