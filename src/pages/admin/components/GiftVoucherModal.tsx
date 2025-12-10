import { useState } from 'react'
import Button from './Button'

interface GiftVoucherModalProps {
    isOpen: boolean
    onClose: () => void
    selectedCustomers: Array<{ id: string; nome?: string; cognome?: string; email: string | null }>
    onSend: (data: { subject: string; message: string; image: File | null; channel?: 'email' | 'whatsapp' }) => Promise<void>
}

export default function GiftVoucherModal({ isOpen, onClose, selectedCustomers, onSend }: GiftVoucherModalProps) {
    const [channel, setChannel] = useState<'email' | 'whatsapp'>('email')
    const [subject, setSubject] = useState('🎁 Buono Regalo per te!')
    const [message, setMessage] = useState('Caro/a {nome},\n\nSiamo lieti di inviarti questo buono regalo!\n\nCordiali saluti,\nDR7 Empire')
    const [image, setImage] = useState<File | null>(null)
    const [imagePreview, setImagePreview] = useState<string | null>(null)
    const [sending, setSending] = useState(false)

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            // Validate file type
            if (!file.type.startsWith('image/')) {
                alert('Per favora seleziona un file immagine (JPEG, PNG)')
                return
            }
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert('L\'immagine è troppo grande. Massimo 5MB.')
                return
            }
            setImage(file)
            // Create preview
            const reader = new FileReader()
            reader.onloadend = () => {
                setImagePreview(reader.result as string)
            }
            reader.readAsDataURL(file)
        }
    }

    const handleSend = async () => {
        if (channel === 'email') {
            if (!image) {
                alert('Per favore carica un\'immagine del buono regalo')
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
            await onSend({ subject, message, image, channel })

            // Reset form
            setSubject('🎁 Buono Regalo per te!')
            setMessage('Caro/a {nome},\n\nSiamo lieti di inviarti questo buono regalo!\n\nCordiali saluti,\nDR7 Empire')
            setImage(null)
            setImagePreview(null)
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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-6 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-white">🎁 Invia Buono Regalo</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-3xl">&times;</button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Channel Selection */}
                    <div className="bg-gray-800 rounded-lg p-4">
                        <label className="block text-sm font-medium text-gray-300 mb-3">Canale di Invio</label>
                        <div className="flex gap-4">
                            <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${channel === 'email' ? 'border-dr7-gold bg-dr7-gold/10' : 'border-gray-600 hover:bg-gray-700'}`}>
                                <input
                                    type="radio"
                                    name="channel"
                                    value="email"
                                    checked={channel === 'email'}
                                    onChange={() => setChannel('email')}
                                    className="text-dr7-gold focus:ring-dr7-gold"
                                />
                                <span className="text-white">📧 Email</span>
                            </label>
                            <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${channel === 'whatsapp' ? 'border-green-500 bg-green-500/10' : 'border-gray-600 hover:bg-gray-700'}`}>
                                <input
                                    type="radio"
                                    name="channel"
                                    value="whatsapp"
                                    checked={channel === 'whatsapp'}
                                    onChange={() => setChannel('whatsapp')}
                                    className="text-green-500 focus:ring-green-500"
                                />
                                <span className="text-white">💬 WhatsApp</span>
                            </label>
                        </div>
                    </div>

                    {/* Selected Customers */}
                    <div className="bg-gray-800 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-300 mb-2">
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
                                <span className="px-3 py-1 bg-gray-700 text-gray-300 rounded-full text-sm">
                                    +{selectedCustomers.length - 10} altri
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Image Upload (Email Only) */}
                    {channel === 'email' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Immagine Buono Regalo *
                            </label>
                            <div className="border-2 border-dashed border-gray-600 rounded-lg p-6 text-center">
                                {imagePreview ? (
                                    <div className="space-y-3">
                                        <img src={imagePreview} alt="Preview" className="max-h-64 mx-auto rounded" />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setImage(null)
                                                setImagePreview(null)
                                            }}
                                            className="text-sm text-red-400 hover:text-red-300"
                                        >
                                            Rimuovi immagine
                                        </button>
                                    </div>
                                ) : (
                                    <div>
                                        <input
                                            type="file"
                                            accept="image/jpeg,image/png,image/jpg"
                                            onChange={handleImageChange}
                                            className="hidden"
                                            id="voucher-image"
                                        />
                                        <label
                                            htmlFor="voucher-image"
                                            className="cursor-pointer inline-block px-4 py-2 bg-dr7-gold text-black rounded hover:bg-dr7-gold/90"
                                        >
                                            📤 Carica Immagine (JPEG/PNG)
                                        </label>
                                        <p className="text-xs text-gray-400 mt-2">Massimo 5MB</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Email Subject (Email Only) */}
                    {channel === 'email' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Oggetto Email *
                            </label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded p-3 text-white focus:border-dr7-gold outline-none"
                                placeholder="🎁 Buono Regalo per te!"
                            />
                        </div>
                    )}

                    {/* Message */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            {channel === 'email' ? 'Messaggio Email *' : 'Messaggio WhatsApp *'}
                        </label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={6}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-3 text-white focus:border-dr7-gold outline-none"
                            placeholder="Scrivi il tuo messaggio..."
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            Usa <code className="bg-gray-700 px-1 rounded">{'{nome}'}</code> e <code className="bg-gray-700 px-1 rounded">{'{cognome}'}</code> per personalizzare
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4 border-t border-gray-700">
                        <Button
                            onClick={onClose}
                            variant="secondary"
                            disabled={sending}
                        >
                            Annulla
                        </Button>
                        <Button
                            onClick={handleSend}
                            disabled={sending || (channel === 'email' && !image)}
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
