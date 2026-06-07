import { useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'

/**
 * Reusable per-card "Addebita" control. Lets an operator charge a SPECIFIC
 * tokenized card a chosen amount. Uses the addebito flow (nexi-nuovo-addebito
 * → pending_addebiti → process-pending-addebiti), which charges with
 * captureType 'IMPLICIT' — a real DEBIT, never a pre-authorization hold.
 *
 * Used in the Nexi tab card list AND in Scheda Cliente (ClientCardInfoModal),
 * so the same debit path is available wherever a card is shown.
 */
interface CardAddebitoButtonProps {
    contractId: string
    customerEmail?: string | null
    customerName?: string | null
    bookingId?: string | null
    /** Short label of the card (e.g. masked PAN) shown in the form for clarity. */
    cardLabel?: string
    /** Called after a successful addebito is scheduled. */
    onDone?: () => void
}

export default function CardAddebitoButton({
    contractId, customerEmail, customerName, bookingId, cardLabel, onDone,
}: CardAddebitoButtonProps) {
    const [open, setOpen] = useState(false)
    const [amount, setAmount] = useState('')
    const [causale, setCausale] = useState('')
    const [sending, setSending] = useState(false)

    const canSubmit = !!contractId && !!customerEmail && parseFloat(amount) > 0 && !sending

    async function submit() {
        if (!contractId) { toast.error('Carta senza contractId — impossibile addebitare'); return }
        if (!customerEmail) { toast.error('Email cliente mancante'); return }
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
                disabled={!contractId}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={contractId ? 'Addebita un importo su questa carta (debito)' : 'Carta non addebitabile'}
            >
                Addebita
            </button>
        )
    }

    return (
        <div className="rounded-lg border border-theme-border bg-theme-bg-secondary p-3 space-y-2 mt-2">
            <div className="text-[11px] uppercase tracking-wide text-theme-text-muted">
                Addebito su carta {cardLabel ? `(${cardLabel})` : ''} — debito immediato
            </div>
            <div className="flex items-center gap-2">
                <span className="text-theme-text-muted text-sm">€</span>
                <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Importo"
                    autoFocus
                    className="flex-1 px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                />
            </div>
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
