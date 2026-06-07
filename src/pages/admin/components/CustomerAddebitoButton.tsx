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
    /** Start with the form already open (e.g. when rendered inside a modal). */
    autoOpen?: boolean
    onDone?: () => void
}

export default function CustomerAddebitoButton({
    cards, customerEmail, customerName, bookingId, defaultContractId, autoOpen, onDone,
}: CustomerAddebitoButtonProps) {
    const defaultCid = (defaultContractId && cards.some(c => c.contractId === defaultContractId))
        ? defaultContractId
        : (cards.find(c => c.isDefault)?.contractId || cards[0]?.contractId || '')

    const [open, setOpen] = useState(!!autoOpen)
    const [amount, setAmount] = useState('')
    const [causale, setCausale] = useState('')
    // Carte selezionate per l'addebito. Default: la carta predefinita. Si
    // possono selezionare piu' carte (o tutte): la cascata le prova in ordine.
    const [selected, setSelected] = useState<Record<string, boolean>>(defaultCid ? { [defaultCid]: true } : {})
    const [sending, setSending] = useState(false)

    if (cards.length === 0) return null

    const cardLabel = (c: NexiCardView) => {
        const pan = c.maskedPan || `…${c.contractId.slice(-6)}`
        const extra = [c.circuit, c.cardType].filter(Boolean).join(' ')
        return `${pan}${extra ? ` — ${extra}` : ''}${c.isDefault ? ' (predefinita)' : ''}`
    }

    // Carte selezionate NELL'ORDINE della lista (la cascata parte dalla prima).
    const orderedSelected = cards.filter(c => selected[c.contractId]).map(c => c.contractId)
    const allSelected = cards.length > 0 && orderedSelected.length === cards.length
    const canSubmit = orderedSelected.length > 0 && !!customerEmail && parseFloat(amount) > 0 && !sending

    const toggleCard = (cid: string) => setSelected(s => ({ ...s, [cid]: !s[cid] }))
    const toggleAll = () => {
        if (allSelected) setSelected(defaultCid ? { [defaultCid]: true } : {})
        else setSelected(Object.fromEntries(cards.map(c => [c.contractId, true])))
    }

    async function submit() {
        if (!customerEmail) { toast.error('Email cliente mancante'); return }
        if (orderedSelected.length === 0) { toast.error('Seleziona almeno una carta'); return }
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
                    contractId: orderedSelected[0],
                    contractIds: orderedSelected.length > 1 ? orderedSelected : undefined,
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

            {/* 2) Scelta carta/e — selezione multipla, cascata in ordine */}
            <div>
                <div className="flex items-center justify-between">
                    <label className="text-[11px] text-theme-text-muted">Carta/e da addebitare</label>
                    {cards.length > 1 && (
                        <button type="button" onClick={toggleAll} className="text-[11px] text-dr7-gold hover:underline">
                            {allSelected ? 'Deseleziona tutte' : 'Seleziona tutte'}
                        </button>
                    )}
                </div>
                <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                    {cards.map(c => (
                        <label key={c.contractId} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-sm cursor-pointer">
                            <input type="checkbox" checked={!!selected[c.contractId]} onChange={() => toggleCard(c.contractId)} className="accent-dr7-gold" />
                            <span className="text-theme-text-primary truncate">{cardLabel(c)}</span>
                        </label>
                    ))}
                </div>
                {orderedSelected.length > 1 && (
                    <div className="text-[10px] text-theme-text-muted mt-1">
                        Cascata: prova in ordine dall'alto e si ferma alla prima carta che accetta (per ogni carta: importo pieno, poi −10%, ecc.).
                    </div>
                )}
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
