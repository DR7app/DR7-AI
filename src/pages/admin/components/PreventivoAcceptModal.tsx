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
    { value: 'pos', label: 'POS / Carta in sede' },
    { value: 'contanti', label: 'Contanti' },
    { value: 'bonifico', label: 'Bonifico bancario' },
    { value: 'nexi_link', label: 'Link Nexi (online)' },
    { value: 'wallet', label: 'Credit Wallet' },
]

function PreventivoAcceptModal({ onConfirm, customers }: Props) {
    const [preventivo, setPreventivo] = useState<AcceptModalPreventivo | null>(null)
    const [customerId, setCustomerId] = useState('')
    const [paymentMethod, setPaymentMethod] = useState('pos')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        function handleOpen(e: Event) {
            const ce = e as CustomEvent<AcceptModalPreventivo>
            if (!ce.detail) return
            setPreventivo(ce.detail)
            setCustomerId('')
            setPaymentMethod('pos')
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
            await onConfirm({ preventivo, customer_id: customerId, payment_method: paymentMethod })
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
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Metodo di pagamento *</label>
                    <div className="space-y-2">
                        {PAYMENT_METHODS.map(pm => (
                            <label key={pm.value} className={`block cursor-pointer rounded-lg border p-3 transition-colors ${paymentMethod === pm.value ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border hover:border-theme-text-muted'}`}>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="radio"
                                        name="paymentMethod"
                                        value={pm.value}
                                        checked={paymentMethod === pm.value}
                                        onChange={() => setPaymentMethod(pm.value)}
                                    />
                                    <span className="text-theme-text-primary text-sm">{pm.label}</span>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

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
