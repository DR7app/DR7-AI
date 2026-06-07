import { useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import type { NexiCardView } from '../../../utils/nexiCards'

/**
 * Single "Addebito" control for a customer that owns one or more tokenized
 * cards. Flow: click Addebito → enter amount + causale → CHOOSE the card →
 * confirm. Charges via the addebito flow (nexi-nuovo-addebito →
 * process-pending-addebiti, captureType 'IMPLICIT') = a real DEBIT, never a
 * pre-authorization hold.
 *
 * Used in Scheda Cliente (ReportClienteModal, CustomersTab detail,
 * ClientCardInfoModal).
 */
interface CustomerAddebitoButtonProps {
    cards: NexiCardView[]
    customerEmail?: string | null
    customerName?: string | null
    bookingId?: string | null
    /** Pre-select this card (e.g. the one that paid the booking). */
    defaultContractId?: string | null
    onDone?: () => void
}

export default function CustomerAddebitoButton({
    cards, customerEmail, customerName, bookingId, defaultContractId, onDone,
}: CustomerAddebitoButtonProps) {
    const initialCard = (defaultContractId && cards.some(c => c.contractId === defaultContractId))
        ? defaultContractId
        : (cards.find(c => c.isDefault)?.contractId || cards[0]?.contractId || '')

    const [open, setOpen] = useState(false)
    const [amount, setAmount] = useState('')
    const [causale, setCausale] = useState('')
    const [contractId, setContractId] = useState(initialCard)
    const [sending, setSending] = useState(false)

    if (cards.length === 0) return null

    const cardLabel = (c: NexiCardView) => {
        const pan = c.maskedPan || `…${c.contractId.slice(-6)}`
        const extra = [c.circuit, c.cardType].filter(Boolean).join(' ')
        return `${pan}${extra ? ` — ${extra}` : ''}${c.isDefault ? ' (predefinita)' : ''}`
    }

    const canSubmit = !!contractId && !!customerEmail && parseFloat(amount) > 0 && !sending

    async function submit() {
        if (!customerEmail) { toast.error('Email cliente mancante'); return }
        if (!contractId) { toast.error('Seleziona una carta'); return }
        const amt = parseFloat(amount)
        if (!amt || amt <= 0) { toast.error('Inserisci un importo valido'); return }

        setSending(true)
        try {
            const res = await authFetch('/.netlify/functions/nexi-nuovo-addebito', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: bookingId || null,
                    customerName: customerName || '',
                    customerEmail,
                    amount: amt.toFixed(2),
                    causale: causale.trim() || `Addebito - ${customerName || customerEmail}`,
                    contractId,
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (res.ok && data.success) {
                toast.success(data.message || 'Addebito programmato')
                setOpen(false)
                setAmount('')
                setCausale('')
                onDone?.()
            } else {
                toast.error(data.error || 'Errore nell\'invio dell\'addebito')
            }
        } catch (err: unknown) {
            toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSending(false)
        }
    }

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50 transition-colors"
            >
                Addebito
            </button>
        )
    }

    return (
        <div className="rounded-lg border border-theme-border bg-theme-bg-secondary p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-theme-text-muted">
                Nuovo addebito — debito immediato
            </div>

            {/* 1) Importo */}
            <div className="flex items-center gap-2">
                <span className="text-theme-text-muted text-sm">€</span>
                <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Importo da addebitare"
                    autoFocus
                    className="flex-1 px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                />
            </div>

            {/* 2) Scelta carta */}
            <div>
                <label className="text-[11px] text-theme-text-muted">Carta da addebitare</label>
                <select
                    value={contractId}
                    onChange={e => setContractId(e.target.value)}
                    className="w-full mt-1 px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                >
                    {cards.map(c => (
                        <option key={c.contractId} value={c.contractId}>{cardLabel(c)}</option>
                    ))}
                </select>
            </div>

            {/* 3) Causale */}
            <input
                type="text"
                value={causale}
                onChange={e => setCausale(e.target.value)}
                placeholder="Causale (opzionale)"
                className="w-full px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
            />

            <div className="flex justify-end gap-2 pt-1">
                <button
                    onClick={() => { setOpen(false); setAmount(''); setCausale('') }}
                    disabled={sending}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover border border-theme-border transition-colors"
                >
                    Annulla
                </button>
                <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {sending ? 'Invio...' : 'Conferma addebito'}
                </button>
            </div>
        </div>
    )
}
