import { useState, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'

/**
 * Modal "Rifiutato" — owns its own state. Listens to a CustomEvent on
 * window so the parent doesn't have to manage state to open it. This avoids
 * re-rendering the (heavy) PreventiviTab when the user clicks "Rifiutato".
 *
 * Renders via a portal at document.body so it's never hidden by a parent
 * stacking context.
 */

const OPEN_EVENT = 'preventivo-reject-modal:open'

export interface RejectModalPreventivo {
    id: string
    vehicle_name: string
}

export interface RejectConfirmArgs {
    preventivo: RejectModalPreventivo
    motivo: 'cauzione' | 'prezzo'
    note: string
}

/** Imperative open helper. Call from anywhere — no React state involved. */
export function openPreventivoRejectModal(p: RejectModalPreventivo) {
    window.dispatchEvent(new CustomEvent<RejectModalPreventivo>(OPEN_EVENT, { detail: p }))
}

interface Props {
    onConfirm: (args: RejectConfirmArgs) => Promise<void> | void
}

function PreventivoRejectModal({ onConfirm }: Props) {
    const [preventivo, setPreventivo] = useState<RejectModalPreventivo | null>(null)
    const [motivo, setMotivo] = useState<'cauzione' | 'prezzo'>('prezzo')
    const [note, setNote] = useState('')
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        function handleOpen(e: Event) {
            const ce = e as CustomEvent<RejectModalPreventivo>
            if (!ce.detail) return
            setPreventivo(ce.detail)
            setMotivo('prezzo')
            setNote('')
            setSubmitting(false)
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
        setSubmitting(true)
        try {
            await onConfirm({ preventivo, motivo, note })
            setPreventivo(null)
        } finally {
            setSubmitting(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4" onClick={() => setPreventivo(null)}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold text-theme-text-primary">Motivo rifiuto</h3>
                    <button onClick={() => setPreventivo(null)} className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary">×</button>
                </div>
                <p className="text-sm text-theme-text-secondary mb-4">
                    Perché il cliente ha rifiutato questo preventivo? ({preventivo.vehicle_name})
                </p>
                <div className="space-y-2 mb-4">
                    {([
                        { value: 'cauzione', label: 'Cauzione', desc: "Cliente non ha accettato l'importo o le condizioni della cauzione" },
                        { value: 'prezzo', label: 'Prezzo', desc: 'Cliente ha trovato il prezzo troppo alto' },
                    ] as const).map(opt => (
                        <label key={opt.value} className={`block cursor-pointer rounded-lg border p-3 transition-colors ${motivo === opt.value ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border hover:border-theme-text-muted'}`}>
                            <div className="flex items-start gap-3">
                                <input
                                    type="radio"
                                    name="rejectMotivo"
                                    value={opt.value}
                                    checked={motivo === opt.value}
                                    onChange={() => setMotivo(opt.value)}
                                    className="mt-1"
                                />
                                <div>
                                    <div className="text-theme-text-primary font-semibold text-sm">{opt.label}</div>
                                    <div className="text-theme-text-muted text-xs">{opt.desc}</div>
                                </div>
                            </div>
                        </label>
                    ))}
                </div>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note aggiuntive (facoltative)..."
                    rows={2}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold mb-4"
                />
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
                        disabled={submitting}
                        className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
                    >
                        {submitting ? 'Salvataggio…' : 'Conferma Rifiuto'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}

export default memo(PreventivoRejectModal)
