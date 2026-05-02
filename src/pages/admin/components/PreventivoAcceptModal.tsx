import { useState, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import CustomerAutocomplete from './CustomerAutocomplete'

/**
 * Modal "Accetta preventivo" — same UX pattern as PreventivoRejectModal:
 * opens via window CustomEvent, renders into a portal at document.body so
 * the parent's heavy list view doesn't have to re-render to manage state.
 *
 * Collects: customer (from clienti lead) + payment method.
 * On confirm: parent's onConfirm creates the booking row and marks the
 * preventivo as accettato.
 */

const OPEN_EVENT = 'preventivo-accept-modal:open'

export interface AcceptModalPreventivo {
    id: string
    vehicle_name: string
    pickup_date: string
    dropoff_date: string
    total_final: number | null
    customer_phone?: string | null
}

export interface AcceptConfirmArgs {
    preventivo: AcceptModalPreventivo
    customer_id: string
    payment_method: string
    payment_status: 'pending' | 'paid'
    amount_paid_eur: number
}

/** Imperative open helper. Call from anywhere — no React state involved. */
export function openPreventivoAcceptModal(p: AcceptModalPreventivo) {
    window.dispatchEvent(new CustomEvent<AcceptModalPreventivo>(OPEN_EVENT, { detail: p }))
}

interface Props {
    onConfirm: (args: AcceptConfirmArgs) => Promise<void> | void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customers: any[]
}

const PAYMENT_METHODS: { value: string; label: string }[] = [
    { value: 'Bonifico', label: 'Bonifico' },
    { value: 'Contanti', label: 'Contanti' },
    { value: 'Credit Wallet', label: 'Credit Wallet' },
    { value: 'Carta di Credito / bancomat', label: 'Carta di Credito / bancomat' },
    { value: 'Paypal', label: 'Paypal' },
    { value: 'RIBA', label: 'RIBA' },
    { value: 'Pay by Link Nexi', label: 'Pay by Link (Nexi)' },
]

function PreventivoAcceptModal({ onConfirm, customers }: Props) {
    const [preventivo, setPreventivo] = useState<AcceptModalPreventivo | null>(null)
    const [customerId, setCustomerId] = useState('')
    const [paymentMethod, setPaymentMethod] = useState('Contanti')
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid'>('pending')
    const [amountPaid, setAmountPaid] = useState('0')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        function handleOpen(e: Event) {
            const ce = e as CustomEvent<AcceptModalPreventivo>
            if (!ce.detail) return
            setPreventivo(ce.detail)
            setCustomerId('')
            setPaymentMethod('Contanti')
            setPaymentStatus('pending')
            setAmountPaid('0')
            setSubmitting(false)
            setError(null)
        }
        window.addEventListener(OPEN_EVENT, handleOpen)
        return () => window.removeEventListener(OPEN_EVENT, handleOpen)
    }, [])

    useEffect(() => {
        if (!preventivo) return
        function handleEsc(e: KeyboardEvent) {
            if (e.key === 'Escape') setPreventivo(null)
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [preventivo])

    if (!preventivo) return null

    async function handleConfirm() {
        if (!preventivo) return
        if (!customerId) {
            setError('Seleziona un cliente dalla lista')
            return
        }
        if (!paymentMethod) {
            setError('Seleziona un metodo di pagamento')
            return
        }
        setSubmitting(true)
        setError(null)
        try {
            const amt = parseFloat(amountPaid) || 0
            await onConfirm({
                preventivo,
                customer_id: customerId,
                payment_method: paymentMethod,
                payment_status: paymentStatus,
                amount_paid_eur: paymentStatus === 'paid' ? (preventivo.total_final ?? 0) : amt,
            })
            setPreventivo(null)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            setError(msg)
        } finally {
            setSubmitting(false)
        }
    }

    const fmtDate = (iso: string) => {
        try { return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) }
        catch { return iso }
    }

    const modal = (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => !submitting && setPreventivo(null)}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold text-theme-text-primary">Accetta preventivo</h3>
                    <button onClick={() => !submitting && setPreventivo(null)} className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary">×</button>
                </div>

                <div className="bg-theme-bg-tertiary border border-theme-border rounded p-3 mb-4 text-sm">
                    <p className="text-theme-text-primary font-semibold">{preventivo.vehicle_name}</p>
                    <p className="text-theme-text-secondary text-xs">{fmtDate(preventivo.pickup_date)} → {fmtDate(preventivo.dropoff_date)}</p>
                    {preventivo.total_final != null && (
                        <p className="text-dr7-gold font-bold mt-1">€{preventivo.total_final.toFixed(2)}</p>
                    )}
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Cliente *</label>
                    <CustomerAutocomplete
                        customers={customers}
                        selectedCustomerId={customerId}
                        onSelectCustomer={(id) => setCustomerId(id)}
                        placeholder="Cerca per nome, email o telefono..."
                        required
                    />
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Stato pagamento *</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setPaymentStatus('pending')}
                            className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${paymentStatus === 'pending' ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-theme-border text-theme-text-secondary hover:border-theme-text-muted'}`}
                        >
                            Da saldare
                        </button>
                        <button
                            type="button"
                            onClick={() => setPaymentStatus('paid')}
                            className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${paymentStatus === 'paid' ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-theme-border text-theme-text-secondary hover:border-theme-text-muted'}`}
                        >
                            Pagato
                        </button>
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Metodo di pagamento *</label>
                    <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                    >
                        {PAYMENT_METHODS.map(pm => (
                            <option key={pm.value} value={pm.value}>{pm.label}</option>
                        ))}
                    </select>
                    {paymentMethod === 'Pay by Link Nexi' && (
                        <p className="text-xs text-theme-text-muted mt-1">Il link Nexi viene generato dopo la creazione della prenotazione.</p>
                    )}
                </div>

                {paymentStatus === 'pending' && (
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Acconto incassato (EUR)</label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={amountPaid}
                            onChange={(e) => setAmountPaid(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                        />
                        <p className="text-xs text-theme-text-muted mt-1">Lascia 0 se nulla e' stato ancora pagato.</p>
                    </div>
                )}

                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-2 mb-3 text-red-300 text-sm">
                        {error}
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => setPreventivo(null)}
                        disabled={submitting}
                        className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary disabled:opacity-50"
                    >
                        Annulla
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={submitting || !customerId}
                        className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
                    >
                        {submitting ? 'Creo prenotazione…' : 'Conferma e crea prenotazione'}
                    </button>
                </div>
            </div>
        </div>
    )

    return createPortal(modal, document.body)
}

export default memo(PreventivoAcceptModal)
