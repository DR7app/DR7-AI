import { useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'

/**
 * Per-card "Elimina" control for the Scheda Cliente card lists. Calls
 * nexi-forget-card, which removes the card from the customer's nexi_cards
 * array (and reassigns the default). Past transactions are kept. The parent
 * hides the card on success via onDeleted.
 */
interface CardDeleteButtonProps {
    contractId: string
    cardLabel?: string
    onDeleted?: (contractId: string) => void
}

export default function CardDeleteButton({ contractId, cardLabel, onDeleted }: CardDeleteButtonProps) {
    const [busy, setBusy] = useState(false)

    async function del() {
        if (!confirm(
            `Eliminare la carta ${cardLabel || `...${contractId.slice(-6)}`}?\n\n` +
            `Non sara' piu' addebitabile. Le transazioni passate restano nello storico.`
        )) return
        setBusy(true)
        try {
            const res = await authFetch('/.netlify/functions/nexi-forget-card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractId }),
            })
            const data = await res.json().catch(() => ({}))
            if (res.ok && data.success) {
                toast.success('Carta eliminata')
                onDeleted?.(contractId)
            } else {
                toast.error(data.error || 'Eliminazione fallita')
            }
        } catch (e) {
            toast.error('Errore: ' + (e instanceof Error ? e.message : String(e)))
        } finally {
            setBusy(false)
        }
    }

    return (
        <button
            onClick={del}
            disabled={busy}
            title="Elimina questa carta"
            className="text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40 whitespace-nowrap"
        >
            {busy ? '...' : 'Elimina'}
        </button>
    )
}
